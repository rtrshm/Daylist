/**
 * This is an example of a basic node.js script that performs
 * the Authorization Code oAuth2 flow to authenticate against
 * the Spotify Accounts.
 *
 * For more information, read
 * https://developer.spotify.com/documentation/web-api/tutorials/code-flow
 */

var express = require('express')
var request = require('request')
var axios = require('axios')
var crypto = require('crypto')
var cors = require('cors')
var querystring = require('querystring')
var cookieParser = require('cookie-parser')
require('dotenv').config()

var client_id = process.env.SPOTIFY_CLIENT_ID // your clientId
var client_secret = process.env.SPOTIFY_CLIENT_SECRET // Your secret
var redirect_uri = 'http://localhost:6969/spotifycallback' // Your redirect uri
var my_playlist_id = '4KjEeQ2TWzJuPsvnRUsFHK'
var access_token, refresh_token
var defaultHeaders = { 'content-type': 'application/x-www-form-urlencoded' }

let timestamp = () => `[${new Date().toLocaleString()}]`

const generateRandomString = length => {
  return crypto.randomBytes(60).toString('hex').slice(0, length)
}

var stateKey = 'spotify_auth_state'

var app = express()

app
  .use(express.static(__dirname + '/public'))
  .use(cors())
  .use(cookieParser())

app.get('/login', function (req, res) {
  var state = generateRandomString(16)
  res.cookie(stateKey, state)

  // your application requests authorization
  var scope =
    'user-read-private\
  user-read-email\
  playlist-read-private\
  playlist-modify-public\
  playlist-modify-private'

  res.redirect(
    'https://accounts.spotify.com/authorize?' +
      querystring.stringify({
        response_type: 'code',
        client_id: client_id,
        scope: scope,
        redirect_uri: redirect_uri,
        state: state
      })
  )
})

app.get('/spotifycallback', function (req, res) {
  // your application requests refresh and access tokens
  // after checking the state parameter

  var code = req.query.code || null
  var state = req.query.state || null
  var storedState = req.cookies ? req.cookies[stateKey] : null

  if (state === null || state !== storedState) {
    res.redirect(
      '/#' +
        querystring.stringify({
          error: 'state_mismatch'
        })
    )
  } else {
    res.clearCookie(stateKey)
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          new Buffer.from(client_id + ':' + client_secret).toString('base64')
      },
      json: true
    }

    request.post(authOptions, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        access_token = body.access_token
        refresh_token = body.refresh_token

        defaultHeaders = {
          'content-type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${access_token}`
        }

        res.status(200)
        res.send()
      } else {
        console.log(`${timestamp()} Invalid token.`)
        res.status(400)
        res.send()
      }
    })
  }
})

let refreshToken = async callback => {
  const refreshTokenOptions = {
    method: 'POST',
    url: 'https://accounts.spotify.com/api/token',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        new Buffer.from(client_id + ':' + client_secret).toString('base64')
    },
    json: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    }
  }

  let { status, data } = await axios(refreshTokenOptions)
  access_token = data.access_token
  refresh_token = data.refresh_token
  defaultHeaders['Authorization'] = `Bearer ${access_token}`

  return callback()
}

let fetchSpotifyDaylist = async () => {
  console.log(`${timestamp()} Fetching daylist...`)

  const query = new URLSearchParams({
    limit: 50
  })

  const requestUrl =
    'https://api.spotify.com/v1/me/playlists?' + query.toString()
  const getPlaylistsOptions = {
    method: 'GET',
    url: requestUrl,
    headers: defaultHeaders,
    json: true
  }

  let { status, data } = await axios(getPlaylistsOptions)
  let spotify_daylist = data.items.find(item =>
    item.name.startsWith('daylist •')
  )
  return spotify_daylist
}

let getDaylistSongs = async daylist => {
  console.log(`${timestamp()} Fetching Spotify daylist songs... `)

  let getDaylistSongsOptions = {
    method: 'GET',
    url: daylist.tracks.href,
    headers: defaultHeaders,
    json: true
  }

  let { status, data } = await axios(getDaylistSongsOptions)
  let song_uris = data.items.map(item => item.track.uri)

  return song_uris
}

let updateDaylistSongs = async daylistSongs => {
  console.log(`${timestamp()} Updating daylist...`)

  let updateDaylistSongsOptions = {
    method: 'PUT',
    url: `https://api.spotify.com/v1/playlists/${my_playlist_id}/tracks`,
    headers: defaultHeaders,
    params: {
        uris: daylistSongs.join()
    }
  }

  let { status, data } = await axios(updateDaylistSongsOptions)
}

let updateDaylistName = async daylistName => {
  console.log(`${timestamp()} Updating daylist...`)

  let updateDaylistNameOptions = {
    method: 'PUT',
    url: `https://api.spotify.com/v1/playlists/${my_playlist_id}`,
    headers: defaultHeaders,
    data: { name: daylistName }
  }

  let { status, data } = await axios(updateDaylistNameOptions)
}

let fetchAndUpdateDaylist = async () => {
  console.log(`${timestamp()} Authorized. Beginning procedure...`)

  var spotify_daylist, spotify_daylist_songs

  try {
    spotify_daylist = await fetchSpotifyDaylist()
    spotify_daylist_songs = await getDaylistSongs(spotify_daylist)
    await updateDaylistSongs(spotify_daylist_songs)
    // await updateDaylistName(spotify_daylist.name.slice(10))
    console.log(`${timestamp()} Successfully updated daylist.`)
  } catch (error) {
    if (error.response.status === 429) {
      console.log(`${timestamp()} Timed out, sleeping and retrying...`)
      await timeout(fetchAndUpdateDaylist)
    } else if (error.response.status === 401) {
      console.log(`${timestamp()} Forbidden, refreshing token...`)
      await refreshToken(fetchAndUpdateDaylist)
    } else {
      console.log(
        `${timestamp()} Fetch or update failed with status ${
          error.response.status
        }.`
      )
    }
  }
}

app.get('/', (req, res) => {
  console.log(`${req.cookies ? req.cookies.state : null}`)
})

const startTask = () => {
  fetchAndUpdateDaylist()
  setInterval(async () => {
    await fetchAndUpdateDaylist()
  }, 30 * 60 * 1000)
}

const startServer = async () => {
  console.log(`Authorize the server by going to http://localhost:6969/login...`)
  while (access_token === undefined) {
    await new Promise(r => setTimeout(r, 5000))
  }
  console.log(`Authorized!`)
  startTask()
}

app.listen(6969, () => {
  console.log(`Listening on 6969...`)
  startServer()
})
