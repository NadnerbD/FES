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
	
	// list of comment objects to be saved
	var commentList = new Array();
	
	// actually scrape the comments
	var comments = document.querySelectorAll("div.comment");
	for(var i = 0; i < comments.length; i++) { 
		var ci = comments[i];
		// the comment will only have a textarea if we own it
		if(ci.getElementsByTagName("textarea").length) {
			var likes = ci.querySelector("span.comment_like_text").firstChild;
			if(likes == null) likes = 0; else likes = parseInt(likes.data.replace(",", ""));
			var dislikes = ci.querySelector("span.comment_dislike_text").firstChild;
			if(dislikes == null) dislikes = 0; else dislikes = parseInt(dislikes.data.replace(",", ""));
			var comment = {
				author: ci.getAttribute("data-author"),
				id: ci.getAttribute("data-comment_id"),
				// the old format date: ci.getElementsByTagName("span")[2].title,
				// the fix: new Date(orig.replace(/[^ ]* ([0-9]*)th of ([^ ]*) (.*)/, "\$2 \$1 \$3"));
				date: new Date(parseInt(ci.querySelector("span.time_offset").getAttribute("data-time")) * 1000),
				data: ci.querySelector("textarea").value,
				ratings: {
					up: likes,
					down: dislikes
				},
				location: commentLocation
			};
			if(path.length == 6) {
				// we're on a chapter page
				comment.chapter = parseInt(path[3]);
			}else{
				// if we're on the main page, then the comment has a chapter marker
				// my god this is painful to fetch
				comment.chapter = parseInt(ci.querySelector("div.comment_information div").childNodes[8].data.split(" ")[2]);
			}
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
	// addLinks only works on compact view pages
	// we'll need to make another function to scrape story pages and non-compact lists
	if(!document.querySelector("table.browse_stories")) return;
	
	var db = new FFDB("fimcomments-db", function() {
		addLinks(document, db);
	}, "resource://fimfic-res/");
}

function addLinks(document, db) {
	console.log("Adding comment links");
	
	var stories = new Array(); // scraped story information to be saved
	
	var items = document.querySelectorAll("table.browse_stories tbody tr.story_item");
	var words = 0;
	for(var i = 0; i < items.length; i++) {
		var item = items[i];
		var link = item.querySelector("a.title");
		var info = item.querySelector("span.info");
		var story = {
			id: link.href.split("/")[4],
			title: link.firstChild.data,
			wordcount: parseInt(info.firstChild.data.split(" ")[0].replace(",", "")),
			ratings: {
				up: parseInt(info.querySelectorAll("img")[0].nextSibling.data.replace(",", "")),
				down: parseInt(info.querySelectorAll("img")[1].nextSibling.data.replace(",", ""))
			},
			tags: {
				category: [catLink.title for(catLink of item.querySelectorAll("a.story_category"))],
				character: [charLink.title for(charLink of info.querySelectorAll("a"))]
			},
			tracking: document.URL.indexOf("tracking=1") != -1,
			read_later: document.URL.indexOf("read_it_later") != -1
		};
		// cull properties we're not sure about (a story appearing in one list does not imply it is not in another)
		if(!story.tracking) delete story.tracking;
		if(!story.read_later) delete story.read_later;
		// finalize data
		stories.push(story);
		words += story.wordcount;
		console.log(JSON.stringify(story));
		
		// fetch all the comments for this story id
		var insertDiv = item.querySelector("td.story_data");
		db.getKeysByIndex("comments", "location", "story/" + story.id, function(insertDiv, story) { return function(keys) {
			if(keys.length) console.log("Found " + keys.length + " comments for story/" + story.id);
			// insert comment links
			for(var cid of keys) {
				var link = document.createElement("span");
				//comment type must be set
				link.setAttribute("class", "comment");
				link.setAttribute("data-type", "0");
				link.innerHTML = '<a class="comment_quote_link" href="#comment/' + 
					cid + '" data-comment_id="' + 
					cid + '">&gt;&gt;' + cid + 
					'<span class="comment_id" style="display:none;">' + 
					cid + '</span></a>';
				link.style.marginLeft = link.style.marginRight = "5px";
				insertDiv.appendChild(link);
			}
		};}(insertDiv, story));
	}
	
	// store the story data
	db.updateItems("stories", stories, function() {
		console.log("Updated " + stories.length + " story records");
	});
	
	// show the wordcount floater
	var styleElem = document.createElement("style");
	styleElem.innerHTML = "div#wordcount:hover { bottom:-20px; } div#wordcount { bottom:-60px; transition: bottom 0.5s ease; }";
	document.body.appendChild(styleElem);
	var element = document.createElement("div");
	element.innerHTML = '\
		<div id="wordcount" class="notification_popup" style="left:10px;display:block;padding:10px;">\
			<span class="notification_title">' + words.toLocaleString() + ' words</span>\
			<a id="viewStories" href="javascript:void(0);">view stored story list</a><br/>\
			<a id="dlStories" href="javascript:void(0);">sync downloaded stories</a>\
		</div>\
	';
	document.body.appendChild(element.firstElementChild);
}