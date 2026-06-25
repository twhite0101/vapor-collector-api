const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const cors = require('cors');
const cron = require('cron');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const { streamArray } = require('stream-json/streamers/stream-array.js');
const fs = require('fs');
require('dotenv').config();

const readStream = fs.createReadStream('storeData.json', { encoding: 'utf8' });

const port = process.env.PORT || 3000;

const storeData = [];
async function streamStoreData() {
  await new Promise((resolve, reject) => {
  readStream
    .pipe(streamArray.withParserAsStream())
    .on('data', (item) => {
      storeData.push(item.value);
    })
    .on('end', resolve)
    .on('error', reject);
  })
}

streamStoreData()

const app = express();
const server = require('http').createServer(app);

app.use(bodyParser.json());
app.use(cookieParser());

app.use(cors({
    origin: process.env.ORIGIN_URL,
    credentials: true,
    optionsSuccessStatus: 200
}));

app.use(express.json());

app.use(session({
    secret: process.env.SECRET_SESSION_KEY,
    resave: true,
    saveUninitialized: true
}));

passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(obj, done) {
    done(null, obj)
});

passport.use(new SteamStrategy({
        returnURL: process.env.PROD_API_URL + 'auth/steam/return' || 'http://localhost:3000/auth/steam/return',
        realm: process.env.PROD_API_URL || 'http://localhost:3000',
        apiKey: process.env.STEAM_API_KEY
    },
  function (identifier, profile, done) {
    process.nextTick(function () {
      profile.identifier = identifier;
      return done(null, profile);
    });
  }
));

app.use(passport.initialize());
app.use(passport.session());

// AUTH
app.get('/auth/steam',
    passport.authenticate('steam', { failureRedirect: process.env.PROD_URL || 'http://localhost:4200/' }));

app.get('/auth/steam/return',
  async (req, res, next) => {
    passport.authenticate('steam', { failureRedirect: process.env.PROD_URL || 'http://localhost:4200/' }, function async (err, user, info) {
      const payload = {
        user: user
      };
      const secretKey = process.env.ACCESS_TOKEN_KEY;
      const options = { expiresIn: 2 * 60 * 60 * 1000 };
      const accessToken = jwt.sign(payload, secretKey, options);
      res.cookie('access', accessToken, { maxAge: 2 * 60 * 60 * 1000, httpOnly: true });
      res.redirect(process.env.PROD_URL + '?lg=true' || 'http://localhost:4200/?lg=true');
    })(req, res, next)
  });

app.get('/auth/token-valid', (req, res) => {
    if (req.cookies.access){
      res.json(true)
    }
    else {
      res.json(false)
    }
  });

app.get('/logout', function(req, res){
  req.logout(function(err) {
    if (err) { return next(err); }
    res.clearCookie('access')
    res.clearCookie('refresh')
    res.redirect(process.env.PROD_URL + '?lg=false' || 'http://localhost:4200/?lg=false');
  });
});

// GET
app.get('/auth/user', ensureAuthenticated, (req, res) => {
    const token = req.cookies.access;
    try {
        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY);
        res.json({ response: decoded.user });
        return;
    } catch (err) {
        // Token is invalid or expired
        res.statusCode(401).json('Unauthorized user');
        return;
    }
  });

  app.get('/user/levelPercent', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const level = req.query.level
  axios
    .get(`https://api.steampowered.com/IPlayerService/GetSteamLevelDistribution/v1/?key=${process.env.STEAM_API_KEY}&player_level=${level}`)
    .then(response => {
      res.send(response.data.response)
    })
    .catch(err => {
      console.error(err)
    })
  });

app.get('/user/getGameLibrary', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const user = decoded.user
  let steamId
  if (req.query.steamId) {
    steamId = req.query.steamId
  }
  else {
    steamId = user.id
  }
  axios
    .get(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}&format=json&include_played_free_games=1&include_appinfo=1&include_extended_appinfo=1`)
    .then(response => {
      res.send(response.data.response)
    })
    .catch(err => {
      console.error(err)
    })
})

app.get('/user/getUserBadges', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const user = decoded.user
  const steamId = req.query.steamId !== undefined ? req.query.steamId : user.id
  axios
    .get(`https://api.steampowered.com/IPlayerService/GetBadges/v1/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}`)
    .then(response => {
      res.send(response.data.response)
    })
    .catch(err => {
      console.error(err)
    })
})

app.get('/user/getRecentlyPlayedGames', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const user = decoded.user
  axios
    .get(`https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${process.env.STEAM_API_KEY}&steamid=${user.id}`)
    .then(response => {
      res.send(response.data.response)
    })
    .catch(err => {
      console.error(err)
    })
})

app.get('/user/getFriendList', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const user = decoded.user
  axios
    .get(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${process.env.STEAM_API_KEY}&steamid=${user.id}&relationship=friend`)
    .then(response => {
      res.send(response.data.friendslist.friends)
    })
    .catch(err => {
      console.error(err)
    })
})

app.get('/user/getAdditionalUserDetails', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const user = decoded.user
  const friendIds = req.query.steamIds
  if (!friendIds) {
    res.statusCode(400).json('Steam ID for friend was not provided.');
  }
  axios
    .get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${process.env.STEAM_API_KEY}&steamids=${friendIds}`)
    .then(response => {
      res.send(response.data.response.players)
    })
    .catch(err => {
      console.error(err)
    })
})

app.get('/game/getNewsForGame', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const appId = req.query.appId
  if (!appId) {
    res.statusCode(400).json('App ID for game was not provided.');
  }
  axios
    .get(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?key=${process.env.STEAM_API_KEY}&appid=${appId}`)
    .then(response => {
      res.send(response.data.appnews)
    })
    .catch(err => {
      console.error(err)
      res.send(err)
    })
})

app.get('/game/getConcurrentPlayers', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const appId = req.query.appId
  if (!appId) {
    res.statusCode(400).json('App ID for game was not provided.');
  }
  axios
    .get(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?key=${process.env.STEAM_API_KEY}&appid=${appId}`)
    .then(response => {
      res.send(response.data.response.player_count)
    })
    .catch(err => {
      console.error(err)
      res.send(err)
    })
})

app.get('/game/getUserStatsForGame', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const user = decoded.user
  const appId = req.query.appId
  if (!appId) {
    res.statusCode(400).json('App ID for game was not provided.');
  }
  axios
    .get(`https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2/?key=${process.env.STEAM_API_KEY}&steamid=${user.id}&appid=${appId}`)
    .then(response => {
      res.send(response.data)
    })
    .catch(err => {
      console.error(err)
      res.send(err)
    })
})

app.get('/game/getSchemaForGame', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const user = decoded.user
  const appId = req.query.appId
  if (!appId) {
    res.statusCode(400).json('App ID for game was not provided.');
  }
  axios
    .get(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${process.env.STEAM_API_KEY}&appid=${appId}`)
    .then(response => {
      res.send(response.data.game)
    })
    .catch(err => {
      console.error(err)
      res.send(err)
    })
})

app.get('/game/getUserAchievements', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const user = decoded.user
  const steamId = req.query.steamId !== undefined ? req.query.steamId : user.id
  const appId = req.query.appId
  axios
    .get(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}&appid=${appId}`)
    .then(response => {
      res.send(response.data.playerstats)
    })
    .catch(err => {
      console.error(err)
      res.send(err)
    })
})

app.get('/game/getGamePrices', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const appIds = req.query.appId
  axios
    .get(`https://store.steampowered.com/api/appdetails/?appids=${appIds}&filters=price_overview`)
    .then(response => {
      res.send(response.data)
    })
    .catch(err => {
      console.error(err)
      res.send(err)
    })
})

app.get('/user/getWishlist', ensureAuthenticated, (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const steamId = req.query.steamId
  axios
    .get(`https://api.steampowered.com/IWishlistService/GetWishlist/v1/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}`)
    .then(response => {
      res.send(response.data.response.items)
    })
    .catch(err => {
      console.error(err)
      res.send(err)
    })
})

app.get('/game/getGameNameLocal', ensureAuthenticated, async (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const appId = Number(req.query.appId)
  try {
    const storeItem = await StoreItem.findOne({ appid: appId })
    res.json(storeItem)
  }
  catch (err) {
    console.error(err)
  }
})

app.get('/game/getStoreDetails', ensureAuthenticated, async (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const appIds = req.query.appIds.split(',').map(Number)
  if (!appIds) {
    res.statusCode(401).json('No appIds query param provided');
  }
  try {
    const results = appIds.map(id => {
      const storeItem = storeData.find(item => item.appId === id)
      if (storeItem) {
        return storeItem
      } else {
        return {
          "appId": 0,
          "name": "",
          "lastModified": 0,
          "priceChangeNumber": 0,
          "currency": "",
          "initial": 0,
          "final": 0,
          "discountPercent": 0,
          "initialFormatted": "",
          "finalFormatted": ""
        }
      }
    })
    res.json(results)
  }
  catch (error) {
    console.error(error)
  }
})

app.get('/user/getProfileItems', ensureAuthenticated, async (req, res) => {
  const token = req.cookies.access;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_KEY)
  if (!decoded) {
    res.statusCode(401).json('Unauthorized user');
  }
  const steamId = req.query.steamId !== undefined ? req.query.steamId : decoded.user.id
  axios
    .get(`https://api.steampowered.com/IPlayerService/GetProfileItemsEquipped/v1/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}`)
    .then(response => {
      res.send(response.data.response)
    })
    .catch(err => {
      console.error(err)
      res.send(err)
    })
})

// MIDDLEWARE
function ensureAuthenticated(req, res, next) {
    if (req.cookies && req.cookies.access) { return next(); }
    res.redirect('/');
};

app.listen(port, () => {
  console.log("server starter on port: ", port)
})
