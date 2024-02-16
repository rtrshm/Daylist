/**
 * This is an example of a basic node.js script that performs
 * the Authorization Code oAuth2 flow to authenticate against
 * the Spotify Accounts.
 *
 * For more information, read
 * https://developer.spotify.com/documentation/web-api/tutorials/code-flow
 */

var express = require('express');
var request = require('request');
var crypto = require('crypto');
var cors = require('cors');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
require('dotenv').config()


var client_id = process.env.SPOTIFY_CLIENT_ID; // your clientId
var client_secret = process.env.SPOTIFY_CLIENT_SECRET; // Your secret
var redirect_uri = 'http://localhost:6969/spotifycallback'; // Your redirect uri
var my_playlist_id = '4KjEeQ2TWzJuPsvnRUsFHK';
var access_token, refresh_token = "";

const generateRandomString = (length) => {
  return crypto
  .randomBytes(60)
  .toString('hex')
  .slice(0, length);
}

var stateKey = 'spotify_auth_state';

var app = express();

app.use(express.static(__dirname + '/public'))
   .use(cors())
   .use(cookieParser());

app.get('/login', function(req, res) {

  var state = generateRandomString(16);
  res.cookie(stateKey, state);

  // your application requests authorization
  var scope = 'user-read-private\
  user-read-email\
  playlist-read-private\
  playlist-modify-public\
  playlist-modify-private';
  
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    }));
});

app.get('/spotifycallback', function(req, res) {

  // your application requests refresh and access tokens
  // after checking the state parameter

  var code = req.query.code || null;
  var state = req.query.state || null;
  var storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    res.clearCookie(stateKey);
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + (new Buffer.from(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    };

    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {

        access_token = body.access_token;
        refresh_token = body.refresh_token;

        res.redirect('/authorized');

      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          }));
      }
    });
  }
});

app.get('/refresh_token', function(req, res) {

  refresh_token = req.query.refresh_token;
  var authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    headers: { 
      'content-type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + (new Buffer.from(client_id + ':' + client_secret).toString('base64')) 
    },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    },
    json: true
  };

  request.post(authOptions, function(error, response, body) {
    if (!error && response.statusCode === 200) {
      var access_token = body.access_token,
          refresh_token = body.refresh_token;
      res.send({
        'access_token': access_token,
        'refresh_token': refresh_token
      });
    }
  });
});

app.get('/authorized', function (req, res) {

    console.log("Fetching daylist...")
    song_ids = []

    const query = new URLSearchParams({
        limit: 50
    });

    let defaultHeaders = {
        'content-type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${access_token}`
    }

    const requestUrl = 'https://api.spotify.com/v1/me/playlists?' + query.toString();
    var getPlaylistsOptions = {
        url: requestUrl,
        headers: defaultHeaders,
        json:true
    }

    request.get(getPlaylistsOptions, function (err, response, body) {
        if (!err && response.statusCode === 200) {
            console.log(`${body.items.map(item => item.name)}`);
            let spotify_daylist = body.items.find(item => item.name.startsWith("daylist •"));
            if (spotify_daylist === undefined) {
                console.log("Failed to find spotify daylist");
                throw "Failed to find spotify daylist";
            }

            let getDaylistSongsOptions = {
                url: spotify_daylist.tracks.href,
                headers: defaultHeaders,
                json: true
            }

            console.log("Attempting to fetch daylist songs...")
            request.get(getDaylistSongsOptions, function (err, response, body) {
                if (!err && response.statusCode === 200) {
                    let song_ids = []
                    song_ids.push(body.items.map(x => x.track.uri));

                    let updateSongParams = new URLSearchParams({
                        uris: song_ids.toString()
                    })

                    let updateMyDaylistSongsOptions = {
                        url: `https://api.spotify.com/v1/playlists/${my_playlist_id}/tracks?${updateSongParams.toString()}`,
                        headers: defaultHeaders
                    };

                    console.log(updateMyDaylistSongsOptions);

                    console.log("Attempting to update daylist songs...");
                    request.put(updateMyDaylistSongsOptions, (err, response, body) => {
                        if (!err && response.statusCode === 201) {
                            console.log("Updated my daylist songs!");
                        } else if (err) {
                            console.log(err);
                        } else {
                            console.log(`Request failed with status ${response.statusCode + "" + response.statusMessage}`)
                        }
                    });

                    let newName = spotify_daylist.name.slice(10);

                    let updateMyDaylistDetailsOptions = {
                        url: `https://api.spotify.com/v1/playlists/${my_playlist_id}`,
                        headers: defaultHeaders,
                        json: {
                            "name": newName
                        }
                    }

                    console.log("Attempting to update daylist details...");
                    request.put(updateMyDaylistDetailsOptions, (err, response, body) => {
                        if (!err && response.statusCode === 200) {
                            console.log("Updated my daylist name!");
                        } else if (err) {
                            console.log(err);
                        } else {
                            console.log(`Change name request failed with status\
                            ${response.statusCode + "" + response.statusMessage}`);
                        }
                    });

                    response
    
                } else if (err) {
                    console.log(err);
                } else {
                    console.log(`Request failed with status ${response.statusCode + "" + response.statusMessage}`)
                }
            });
        } else if (err) {
            console.log(err);
        } else {
            console.log(`Request failed with status ${response.statusCode + "" + response.statusMessage}`)
        }
    })

})

console.log('Listening on 6969');
app.listen(6969);