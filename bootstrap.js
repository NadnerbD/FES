// No bullshit, just what's necessary to actually make shit work
var console = Components.utils.import("resource://gre/modules/devtools/Console.jsm", {}).console;

function install(data, reason) {}

function uninstall(data, reason) {}

var obs;
function startup(data, reason) {
	console.log("FES Starting");
	// first up, set up a resource alias for our local files
	var ioServ = Components.classes["@mozilla.org/network/io-service;1"].createInstance(Components.interfaces.nsIIOService);
	var resHandler = ioServ.getProtocolHandler("resource").QueryInterface(Components.interfaces.nsIResProtocolHandler);
	var alias = ioServ.newFileURI(data.installPath);
	if(!data.installPath.isDirectory()) {
		alias = ioServ.newURI("jar:" + alias.spec + "!/", null, null);
	}
	resHandler.setSubstitution("fimfic-res", alias);
	// import FFDB
	Components.utils.import("resource://fimfic-res/idb-wrapper.js");
	// we'll user the observer service MONITOR EVERYTHING
	// specifically, watch for pageloads across the whole application
	obs = new pageLoadObserver();
}

function shutdown(data, reason) {
	if(reason == APP_SHUTDOWN) return;
	console.log("FES Shutting down");
	// stop watching
	obs.unregister();
	// unload FFDB
	Components.utils.unload("resource://fimfic-res/idb-wrapper.js");
	// unregister our resource handler
	var ioServ = Components.classes["@mozilla.org/network/io-service;1"].createInstance(Components.interfaces.nsIIOService);
	var resHandler = ioServ.getProtocolHandler("resource").QueryInterface(Components.interfaces.nsIResProtocolHandler);
	resHandler.setSubstitution("fimfic-res", null);
}

//// stuff, should be moved to modules later

function pageLoadObserver() {
	this.register();
}
pageLoadObserver.prototype = {
	observe: function(subject, topic, data) {
		// this event is too early, of course, we'll wait for it load
		subject.addEventListener("DOMContentLoaded", handleNewPage, false);
	},
	register: function() {
		var obs = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
		obs.addObserver(this, "content-document-global-created", false);
	},
	unregister: function() {
		var obs = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
		obs.removeObserver(this, "content-document-global-created", false);
	}
};

var locs = [
	[/https?:\/\/(www\.)?fimfiction\.net\/(index\.php\?view=category)|(stories).*/, linkComments],
	[/https?:\/\/(www\.)?fimfiction\.net\/story\/.*/, watchComments],
	[/https?:\/\/(www\.)?fimfiction\.net.*/, changeHeader]
];
	
function handleNewPage(event) {
	var document = event.target;
	for(var i in locs) {
		if(locs[i][0].exec(document.URL)) {
			locs[i][1](document);
		}
	}
}

function changeHeader(document) {
	// yes I'm petty
	try {
		document.getElementsByClassName("home_link")[0].children[0].children[0].src = "resource://fimfic-res/logo_fix.png";
	} catch (e) {
		console.log("Failed to replace header on: " + document.URL + "\n" + e.message);
	}
}

function watchComments(document) {
	var obs = new document.defaultView.MutationObserver(function(muts) { scrapeComments(document); });
	var clist = document.getElementsByClassName("comment_list")[0];
	obs.observe(clist, {childList: true});
	// do an initial scrape
	scrapeComments(document);
}

function scrapeComments(document) {
	var path = document.location.pathname.split("/");
	var commentLocation = path[1] + "/" + path[2];
	
	console.log("Starting comment scrape of location " + commentLocation);
	
	var commentList = new Array();
	var comments = document.getElementsByClassName("comment");
	for(var i = 0; i < comments.length; i++) { 
		var ci = comments[i];
		// the comment will only have a textarea if we can edit it
		// if we can edit it, it is ours
		if(ci.getElementsByTagName("textarea").length) {
			var comment = {
				author: ci.getAttribute("data-author"),
				id: ci.getAttribute("data-comment_id"),
				date: ci.getElementsByTagName("span")[2].title,
				data: ci.getElementsByTagName("textarea")[0].value,
				ratings: {
					up: ci.getElementsByClassName("comment_like")[0].getAttribute("data-like"),
					down: ci.getElementsByClassName("comment_like")[1].getAttribute("data-like")
				},
				location: commentLocation
			};
			commentList.push(comment);
			console.log("Scraped comment " + comment.id);
		}
	}
	// save our work
	if(commentList.length) {
		var firstAuthor = commentList[0].author;
		var firstId = commentList[0].id;
		var db = new FFDB("fimcomments-db", function() {
			db.putItems("comments", commentList, function() {
				console.log("Saved " + commentList.length + " comments");
				// check that we have the user data for this comment
				db.getItem("users", firstAuthor, function(item) {
					if(!item) {
						// user is not saved, save user data
						saveUserAvatar(firstAuthor, document.querySelector("div#comment_content_" + firstId + " div.avatar img").src);
					}else{
						db.close();
					}
				});
			});
		}, "resource://fimfic-res/"); // this should allow our addon documents to access this database from their local scope
	}
	// record an image in the database
	function saveUserAvatar(name, imgSrc) {
		console.log("Getting avatar: " + imgSrc + " for " + name);
		var req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();
		req.open("GET", imgSrc, true);
		req.responseType = "blob";
		req.onload = function() {
			if(req.status == 200) {
				db.putItem("users", {name: name, avatar: req.response}, function() {
					console.log("Saved avatar for: " + name);
					db.close();
				});
			}
		};
		req.send();
	}
}

function linkComments(document) {
	var div = document.createElement("div");
	div.style = "position:fixed; bottom: 10px; right: 10px; background-color: red; padding: 10px;";
	div.innerHTML = "FIMFICTION DETECTED";
	document.body.appendChild(div);
}