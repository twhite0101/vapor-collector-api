const axios = require('axios')
const StoreItem = require('./db/StoreItem')
const fs = require('fs')
require('dotenv').config()

export async function getStoreItemsAndConsolidate () {
  console.log('Starting scraping job...')
  let numOfReq = 1
  let moreToReturn
  let lastAppId
  let requestsInProgress = true
  let requestIndex = 0
  let storedStoreItems = []
  let itemsWithPrices = []
  try {
    const response = await axios.get(`https://api.steampowered.com/IStoreService/GetAppList/v1/?key=${process.env.STEAM_API_KEY}&include_dlc=true&max_results=50000`)
    storedStoreItems.push(...response.data.response.apps)
    console.log(`Total Steam Apps Returned After Request #${numOfReq} - ${storedStoreItems.length}`)
    lastAppId = response.data.response.last_appid
    moreToReturn = response.data.response.have_more_results
    while (moreToReturn === true) {
      const response = await axios.get(`https://api.steampowered.com/IStoreService/GetAppList/v1/?key=${process.env.STEAM_API_KEY}&include_dlc=true&last_appid=${lastAppId}&max_results=50000`)
      numOfReq += 1
      storedStoreItems.push(...response.data.response.apps)
      console.log(`Total Steam Apps Returned After Request #${numOfReq} - ${storedStoreItems.length}`)
      lastAppId = response.data.response.last_appid
      moreToReturn = response.data.response.have_more_results
    }
    console.log(`All Steam Apps Returned. Number of Requests Needed: ${numOfReq}. Total Apps Returned: ${storedStoreItems.length}`)

    console.log('Gathering price info for Steam Apps...')

    const appIds = storedStoreItems.map(item => item.appid)

    const multipleReqArrays = separateArrayIntoChunks(appIds, 300)

    const gamePricesLinks = multipleReqArrays.map(chunk => `https://store.steampowered.com/api/appdetails/?appids=${chunk.join(',')}&filters=price_overview`)

    const gamePricesLinksChunks = separateArrayIntoChunks(gamePricesLinks, 200);

    while (requestsInProgress) {
      if (requestIndex > 0) {
        console.log('Awaiting for next set of requests to adhere to Steam Store API request limit...')
        await timeout(360000)
      }
      await loopPriceRequests(gamePricesLinksChunks[requestIndex], storedStoreItems, itemsWithPrices)
      requestsInProgress = requestIndex < gamePricesLinksChunks.length - 1
      requestIndex = requestIndex + 1
    }
    console.log('Finished gathering prices and applying to Store Items.');

    console.log('Starting to write Store Items to file...');

    const itemsToJSON = JSON.stringify(itemsWithPrices, null, 2)

    const writeStream = fs.createWriteStream('storeData.json')

    const overWatermark = writeStream.write(itemsToJSON)

    if (!overWatermark) {
      await new Promise((resolve) => writeStream.once('drain', resolve))
    }

    writeStream.end()

    console.log('Finished writing Store Items to file.');

    if (process.env.NODE_ENV === 'development') {
      return itemsWithPrices
    }
  }
  catch (err) {
    console.error('Error calling or saving store data:', err)
  }
}

const scrapeSteamStoreAndSave = async () => {
  let newRecordsAdded = 0
  await getStoreItemsAndConsolidate()
    .then(storeItems => {
      storeItems.forEach(item => {
          StoreItem.findOne({ appid: item.appid })
            .then(async (itemFound, err) => {
              if (err) {
                console.error(err)
              }

              if (!itemFound) {
                await StoreItem.insertOne(item)
                console.log('New Store Item saved to DB')
                newRecordsAdded += 1
              }
            })
        })
      return newRecordsAdded
    })
}

async function loopPriceRequests (linksArray, items, destinationArray) {
  let chunkIndex = 0
  let areChunkRequestsRemaining = true
  const linkSubArrays = separateArrayIntoChunks(linksArray, 10)

  while (areChunkRequestsRemaining) {
    const promises = linkSubArrays[chunkIndex].map(link => axios.get(link))
    await Promise.all(promises)
      .then(responses => {
        responses.forEach(response => {
          Object.entries(response.data).map(([key, value]) => {
            const matchIndex = items.findIndex(item => item.appid === Number(key))
            destinationArray.push(createStoreItemsFromResponse(validDataResponseCheck(value), items[matchIndex], value.data))
          })
        })
        areChunkRequestsRemaining = chunkIndex < linkSubArrays.length - 1
        if (areChunkRequestsRemaining) {
          chunkIndex = chunkIndex + 1
        }
        console.log("Price formatting finished. Apps added: ", destinationArray.length)
      })
      .catch(err => {
        console.error(err)
      })
  }
}

const separateArrayIntoChunks = (items, chunkSize) => {
  const multipleAppIdArrays = []

  for (let i = 0; i < items.length; i += chunkSize) {
    multipleAppIdArrays.push(items.slice(i, i + chunkSize))
  }

  return multipleAppIdArrays
}

const validDataResponseCheck = (response) => {
  let valid
  if (response.success === false) {
    valid = false
  }
  else if (response.data.price_overview === undefined || Array.isArray(response.data.price_overview)) {
    valid = false
  }
  else {
    valid = true
  }
  return valid
}

const createStoreItemsFromResponse = (valid, storeItem, priceData) => {
  if (valid) {
    return {
      "appId": storeItem.appid,
      "name": storeItem.name,
      "lastModified": storeItem.last_modified,
      "priceChangeNumber": storeItem.price_change_number,
      "currency": priceData.price_overview.currency,
      "initial": priceData.price_overview.initial,
      "final": priceData.price_overview.final,
      "discountPercent": priceData.price_overview.discount_percent,
      "initialFormatted": priceData.price_overview.initial_formatted,
      "finalFormatted": priceData.price_overview.final_formatted
    }
  }
  else {
    return {
      "appId": storeItem.appid,
      "name": storeItem.name,
      "lastModified": storeItem.last_modified,
      "priceChangeNumber": storeItem.price_change_number,
      "currency": "",
      "initial": 0,
      "final": 0,
      "discountPercent": 0,
      "initialFormatted": "",
      "finalFormatted": ""
    }
  }
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = { scrape:getStoreItemsAndConsolidate, scrapeAndSave: scrapeSteamStoreAndSave }
