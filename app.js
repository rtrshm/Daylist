var express = require("express");
var axios = require("axios");
var crypto = require("crypto");
var cors = require("cors");
var cookieParser = require("cookie-parser");
require("dotenv").config();

var client_id = process.env.SPOTIFY_CLIENT_ID; // your clientId
var client_secret = process.env.SPOTIFY_CLIENT_SECRET; // Your secret
var redirect_uri = "http://10.0.111.98:6969/spotifycallback"; // Your redirect uri
var my_playlist_id = "4KjEeQ2TWzJuPsvnRUsFHK";
var access_token, refresh_token;
var defaultHeaders = { "content-type": "application/x-www-form-urlencoded" };

let timestamp = () => `[${new Date().toLocaleString()}]`;

const generateRandomString = (length) => {
    return crypto.randomBytes(60).toString("hex").slice(0, length);
};

var stateKey = "spotify_auth_state";

var app = express();

app.use(express.static(__dirname + "/public"))
    .use(cors())
    .use(cookieParser());

app.get("/login", (req, res) => {
    var state = generateRandomString(16);
    res.cookie(stateKey, state);

    var scope =
        "user-read-private\
  user-read-email\
  playlist-read-private\
  playlist-modify-public\
  playlist-modify-private";

    const authQueryParams = new URLSearchParams({
        response_type: "code",
        client_id: client_id,
        scope: scope,
        redirect_uri: redirect_uri,
        state: state,
    });

    res.redirect(
        "https://accounts.spotify.com/authorize?" + authQueryParams.toString()
    );
});

app.get("/spotifycallback", async (req, res) => {
    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
        console.log(`${timestamp()} State mismatch.`);
        res.status(400);
        res.send();
    } else {
        res.clearCookie(stateKey);
        var authOptions = {
            method: "POST",
            url: "https://accounts.spotify.com/api/token",
            data: {
                code: code,
                redirect_uri: redirect_uri,
                grant_type: "authorization_code",
            },
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                Authorization:
                    "Basic " +
                    new Buffer.from(client_id + ":" + client_secret).toString(
                        "base64"
                    ),
            },
            json: true,
        };

        try {
            let { data } = await axios(authOptions);

            access_token = data.access_token;
            refresh_token = data.refresh_token;

            defaultHeaders = {
                "content-type": "application/x-www-form-urlencoded",
                Authorization: `Bearer ${access_token}`,
            };

            res.status(200);
            res.send();
        } catch (error) {
            console.log(error);
            console.log(`${timestamp()} Invalid token.`);
            res.status(400);
            res.send();
        }
    }
});

let refreshToken = async () => {
    console.log(`${timestamp()} Refreshing token...`);
    const refreshTokenOptions = {
        method: "POST",
        url: "https://accounts.spotify.com/api/token",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            Authorization:
                "Basic " +
                new Buffer.from(client_id + ":" + client_secret).toString(
                    "base64"
                ),
        },
        data: {
            grant_type: "refresh_token",
            refresh_token: refresh_token,
        },
        json: true,
    };

    let { data } = await axios(refreshTokenOptions);

    access_token = data.access_token;
    defaultHeaders["Authorization"] = `Bearer ${access_token}`;
    console.log(`${timestamp()} Token refreshed.`);
};

let fetchSpotifyDaylist = async () => {
    console.log(`${timestamp()} Fetching daylist...`);

    const query = new URLSearchParams({
        limit: 50,
    });

    const requestUrl =
        "https://api.spotify.com/v1/me/playlists?" + query.toString();
    const getPlaylistsOptions = {
        method: "GET",
        url: requestUrl,
        headers: defaultHeaders,
        json: true,
    };

    let { data } = await axios(getPlaylistsOptions);
    let spotify_daylist = data.items.find(
        (item) =>
            (item.name.startsWith("daylist •") || item.name === "daylist") &&
            item.owner.id == "spotify"
    );

    if (spotify_daylist.name === "daylist") {
        const queryPlaylistToRefresh = {
            method: "GET",
            url: spotify_daylist.href,
            headers: defaultHeaders,
            json: true,
        };

        ({ spotify_daylist } = await axios(queryPlaylistToRefresh));

        while (spotify_daylist.tracks === undefined) {
            console.log(
                `${timestamp()} Need to poke daylist to force update, querying...`
            );

            ({ spotify_daylist } = await axios(queryPlaylistToRefresh));
        }
    }

    return spotify_daylist;
};

let getDaylistSongs = async (daylist) => {
    console.log(`${timestamp()} Fetching Spotify daylist songs... `);

    let getDaylistSongsOptions = {
        method: "GET",
        url: daylist.tracks.href,
        headers: defaultHeaders,
        json: true,
    };

    let { data } = await axios(getDaylistSongsOptions);
    let song_uris = data.items.map((item) => item.track.uri);

    return song_uris;
};

let updateDaylistSongs = async (daylistSongs) => {
    console.log(`${timestamp()} Updating daylist songs...`);

    let updateDaylistSongsOptions = {
        method: "PUT",
        url: `https://api.spotify.com/v1/playlists/${my_playlist_id}/tracks`,
        headers: defaultHeaders,
        params: {
            uris: daylistSongs.join(),
        },
    };

    await axios(updateDaylistSongsOptions);
};

let updateDaylistName = async (daylistName) => {
    console.log(`${timestamp()} Updating daylist name...`);

    let updateDaylistNameOptions = {
        method: "PUT",
        url: `https://api.spotify.com/v1/playlists/${my_playlist_id}`,
        headers: defaultHeaders,
        data: JSON.stringify({
            name: daylistName,
        }),
        json: true,
    };

    await axios(updateDaylistNameOptions);
};

let fetchAndUpdateDaylist = async () => {
    console.log(`${timestamp()} Beginning procedure...`);

    var spotify_daylist, spotify_daylist_songs;

    spotify_daylist = await fetchSpotifyDaylist();
    if (spotify_daylist === undefined) {
        throw "Failed to fetch spotify daylist";
    }

    spotify_daylist_songs = await getDaylistSongs(spotify_daylist);
    if (spotify_daylist_songs === undefined) {
        throw "Failed to fetch daylist songs";
    }
    await updateDaylistSongs(spotify_daylist_songs);
    await updateDaylistName(spotify_daylist.name);
    console.log(`${timestamp()} Successfully updated daylist.`);
};

let startTask = () => {
    fetchAndUpdateDaylist();
    setInterval(async () => {
        await refreshToken();
        await fetchAndUpdateDaylist();
    }, 15 * 60 * 1000);
};

let startServer = async () => {
    console.log(
        `Authorize the server by going to http://10.0.111.98:6969/login...`
    );
    while (access_token === undefined) {
        await new Promise((r) => setTimeout(r, 5000));
    }
    console.log(`Authorized!`);
    startTask();
};

app.listen(6969, () => {
    console.log(`Listening on 6969...`);
    startServer();
});
