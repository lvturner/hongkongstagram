
var request = require("request");
var bodyParser = require("body-parser");
var express = require("express");
var sockio = require("socket.io");
var crypto = require("crypto");
var r = require("rethinkdb");
var q = require("q");

var config = require("./config");

var app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static(__dirname + "/public"));

var api = "https://api.instagram.com/v1/";
var lastUpdate = 0;

var io = sockio.listen(app.listen(config.port), {log: false});
console.log("Server started on port " + config.port);

function subscribeToTag(tagName) {
  var params = {
    client_id: config.instagram.client,
    client_secret: config.instagram.secret,
    verify_token: config.instagram.verify,
    object: "tag", aspect: "media", object_id: tagName,
    callback_url: "http://" + config.host + "/publish/photo"
  };

  request.post({url: api + "subscriptions", form: params},
    function(err, response, body) {
      if (err) {
				console.log("Failed to subscribe:", err);
			} else {
				console.log("Subscribed to tag:", tagName);
			}
  });
}

var conn;
r.connect(config.database).then(function(c) {
  conn = c;
  return r.dbCreate(config.database.db).run(conn);
}).then(function() {
  return r.tableCreate("images").run(conn);
}).then(function() {
  return r.tableCreate("tags").run(conn);
})
.then(function() {
  return q.all([
    r.table("images").indexCreate("time").run(conn),
  ]);
})
.error(function(err) {
  if (err.msg.indexOf("already exists") == -1)
    console.log(err);
})
.finally(function() {
  r.table("images").changes().run(conn)
  .then(function(cursor) {
    cursor.each(function(err, item) {
      if (item && item.new_val) {
        io.sockets.emit("image", item.new_val);
			}
    });
  })
  .error(function(err) {
    console.log("Error:", err);
  });

  subscribeToTag("hongkong");
});

io.sockets.on("connection", function(socket) {
  var conn;
  r.connect(config.database).then(function(c) {
    conn = c;
    return r.table("images")
      .orderBy({index: r.desc("time")})
      .limit(60).run(conn);
  })
  .then(function(cursor) { return cursor.toArray(); })
  .then(function(result) {
    socket.emit("recent", result);
  })
  .error(function(err) { console.log("Failure:", err); })
  .finally(function() {
    if (conn)
      conn.close();
  });

	socket.on("tags", function(limit) {
		var conn;
		r.connect(config.database).then(function(c) {
			conn = c;
			return r.table("tags")
			.orderBy({ index: r.desc("count") })
			.limit(limit)
			.map(function(item) {
				return { text: item("id"), size: item("count") };
			})
			.coerceTo('array')
			.run(conn); })
		.then(function(results) {
			socket.emit("tags", results);
		}).finally(function() {
			if(conn) {
				conn.close();
			}
		});
	});
});

app.get("/publish/photo", function(req, res) {
  if (req.param("hub.verify_token") == config.instagram.verify)
    res.send(req.param("hub.challenge"));
  else res.status(500).json({err: "Verify token incorrect"});
});

app.use("/publish/photo", bodyParser.json({
  verify: function(req, res, buf) {
    var hmac = crypto.createHmac("sha1", config.instagram.secret);
    var hash = hmac.update(buf).digest("hex");

    if (req.header("X-Hub-Signature") == hash)
      req.validOrigin = true;
  }
}));

app.post("/publish/photo", function(req, res) {
  if (!req.validOrigin)
    return res.status(500).json({err: "Invalid signature"});
  
  var update = req.body[0];
  res.json({success: true, kind: update.object});

  if (update.time - lastUpdate < 1) return;
  lastUpdate = update.time;

  var path = api + "tags/" + update.object_id +
             "/media/recent?client_id=" + 
             config.instagram.client;

  var conn;
  r.connect(config.database).then(function(c) {
    conn = c;
    r.db(config.database.db).table("images").insert(
      r.http(path)("data"), { returnChanges: true })("changes")("new_val")("tags").reduce(function(left, right) {
      return left.add(right);
    }).map(function(item) {
      return { id: item, count: 1 };
    }).forEach(function(item) {
     return r.branch(
        r.db(config.database.db).table("tags").get(item("id")),
        r.db(config.database.db).table("tags").get(item("id")).update(function(tag) {
         return { count: tag("count").add(1).default(1) };
        }),
        r.db(config.database.db).table("tags").insert(item)
      ); 
    }).run(conn);
  })
  .error(function(err) { console.log("Failure:", err); })
  .finally(function() {
    if (conn)
      conn.close();
  });
});

