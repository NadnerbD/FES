// No bullshit, just what's necessary to actually make shit work
var console = Components.utils.import("resource://gre/modules/devtools/Console.jsm", {}).console;
var ioServ = Components.classes["@mozilla.org/network/io-service;1"].createInstance(Components.interfaces.nsIIOService);
var resHandler = ioServ.getProtocolHandler("resource").QueryInterface(Components.interfaces.nsIResProtocolHandler);
var obsServ = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
var winMed = Components.classes['@mozilla.org/appshell/window-mediator;1'].getService(Components.interfaces.nsIWindowMediator);

function install(data, reason) {}

function uninstall(data, reason) {}

var obs; // our page load observer

function startup(data, reason) {
	console.log("FES Starting");
	// first up, set up a resource alias for our local files
	var alias = ioServ.newFileURI(data.installPath);
	if(!data.installPath.isDirectory()) {
		alias = ioServ.newURI("jar:" + alias.spec + "!/", null, null);
	}
	resHandler.setSubstitution("fimfic-res", alias);
	// import our local modules (This is done here because we need our alias first)
	Components.utils.import("resource://fimfic-res/idb-wrapper.js");
	Components.utils.import("resource://fimfic-res/sync-download.js");
	// we'll user the observer service MONITOR EVERYTHING
	// specifically, watch for pageloads across the whole application
	obs = new pageLoadObserver();
}

function shutdown(data, reason) {
	if(reason == APP_SHUTDOWN) return;
	console.log("FES Shutting down");
	// stop watching for pageloads
	obs.unregister();
	// unload our local modules
	Components.utils.unload("resource://fimfic-res/idb-wrapper.js");
	Components.utils.unload("resource://fimfic-res/sync-download.js");
	// unregister our resource handler
	resHandler.setSubstitution("fimfic-res", null);
}

function pageLoadObserver() {
	this.register();
}
pageLoadObserver.prototype = {
	observe: function(subject, topic, data) {
		// this event is too early, of course, we'll wait for it load
		subject.addEventListener("DOMContentLoaded", handleNewPage, false);
	},
	register: function() {
		obsServ.addObserver(this, "content-document-global-created", false);
	},
	unregister: function() {
		obsServ.removeObserver(this, "content-document-global-created", false);
	}
};

//// Actual implementation stuff, should be moved to modules later

var locs = [
	// story-card elements can appear in a lot of places
	[/https?:\/\/(www\.)?fimfiction\.net\/(index\.php\?view=category)|(stories)|(bookshelf)|(user).*/, linkComments],
	[/https?:\/\/(www\.)?fimfiction\.net\/story\/.*/, watchComments],
	[/https?:\/\/(www\.)?fimfiction\.net.*/, changeHeader],
	[/resource:\/\/fimfic-res\/story_list\.html/, setupMessageListener]
];
	
function handleNewPage(event) {
	var document = event.target;
	for(var i in locs) {
		// iframes for some inexplicable reason can have the URL property of their parent
		// document, so we must check that the document is not iframe content before proceeding
		if(locs[i][0].exec(document.URL) && !document.defaultView.frameElement) {
			locs[i][1](document);
		}
	}
}

function setupMessageListener(document) {
	// listen for postMessage events directed at the window
	document.defaultView.addEventListener("message", function(e) {
		// ensure that the message actually came from our window
		if(e.origin != "resource://fimfic-res") return;
		switch(e.data.request) {
			case "CopyString":
				var clipboardHelper = Components.classes["@mozilla.org/widget/clipboardhelper;1"].getService(Components.interfaces.nsIClipboardHelper);
				clipboardHelper.copyString(e.data.string);
			break;
			case "PickFolder":
				var filePicker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
				filePicker.init(e.source, e.data.title, filePicker.modeGetFolder);
				filePicker.open(function() {
					e.source.postMessage({
						request: "PickedFolder",
						title: e.data.title,
						// file can be null if the user didn't actually pick a file
						folder: filePicker.file ? filePicker.file.path : null
					}, "resource://fimfic-res");
				});
			break;
			case "SyncFolders":
				syncDirectories(e.data.files, e.data.dest, e.data.source, e.data.deleteFromSource, e.data.keepOld, function(logStr) {
					e.source.postMessage({
						request: "SyncStatusLog",
						msg: logStr
					}, "resource://fimfic-res");
				});
			default:
				// do nothing
			break;
		}
	}, false, true);
}

function changeHeader(document) {
	// yes I'm petty
	try {
		document.getElementsByClassName("home_link")[0].children[0].children[0].src = "resource://fimfic-res/logo_fix.png";
	} catch (e) {
		console.log("Failed to replace header:\n" + e.message);
		console.log(document);
	}
}

function watchComments(document) {
	var obs = new document.defaultView.MutationObserver(function(muts) { scrapeComments(document); });
	var clist = document.getElementsByClassName("comment_list")[0];
	obs.observe(clist, {childList: true});
	// do an initial scrape
	scrapeComments(document);
	scrapeStories(document);
}

function scrapeComments(document) {
	var path = document.location.pathname.split("/");
	var commentLocation = path[1] + "/" + path[2];
	
	console.log("Starting comment scrape of location " + commentLocation);
	
	// list of comment objects to be saved
	var commentList = new Array();
	
	// actually scrape the comments
	var comments = document.querySelectorAll("div#story_comments div.comment");
	for(var i = 0; i < comments.length; i++) { 
		var ci = comments[i];
		// the comment will only have a textarea if we own it
		if(ci.getElementsByTagName("textarea").length) {
			var likes, dislikes;
			var likeSpan = ci.querySelector("span.comment_like_text");
			if(likeSpan == null || likeSpan.firstChild == null) likes = 0; else likes = parseInt(likeSpan.firstChild.data.replace(/,/g, ""));
			var dislikeSpan = ci.querySelector("span.comment_dislike_text");
			if(dislikeSpan == null || dislikeSpan.firstChild == null) dislikes = 0; else dislikes = parseInt(dislikeSpan.firstChild.data.replace(/,/g, ""));
			var comment = {
				author: ci.getAttribute("data-author"),
				id: ci.getAttribute("data-comment_id"),
				// the old format date: ci.getElementsByTagName("span")[2].title,
				// the fix: new Date(orig.replace(/[^ ]* ([0-9]*).. of ([^ ]*) (.*)/, "\$2 \$1 \$3"));
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
				// there will be no marker if there is only one chapter
				// we can extract the chapter number from the url
				var infoLinks = ci.querySelectorAll("div.comment_information a");
				if(infoLinks.length >= 3 && !infoLinks[2].classList.contains("comment_callbacks")) {
					comment.chapter = parseInt(infoLinks[2].href.split("/")[5]);
				}else{
					comment.chapter = 1;
				}
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
				// update the comment_count, oldest_comment, and newest_comment fields
				db.getItemsByIndex("comments", "location", commentLocation, function(items) {
					var update = {
						id: path[2], 
						comment_count: items.length,
						oldest_comment: items[0].date, 
						newest_comment: items[items.length - 1].date
					};
					db.updateItems("stories", [update], function() {
						console.log(commentLocation + " has " + update.comment_count + 
							" comments (oldest: " + update.oldest_comment + ", newest: " + update.newest_comment + ")"
						);
					});
				});
				// check that we have the user data for this comment
				db.getItem("users", firstAuthor, function(item) {
					if(!item) {
						// user is not saved, save user data
						saveUserAvatar(firstAuthor, document.querySelector("div#comment_content_" + firstId + " div.avatar img").src);
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
	if(document.querySelector("ul.story-card-list")) {
		// if we're in compact view, we can add links
		var db = new FFDB("fimcomments-db", function() {
			addLinks(document, db);
		}, "resource://fimfic-res/");
	}else{
		// if we're in full-view, we can at least update our story information
		scrapeStories(document);
	}
}

function addLinks(document, db) {
	// scrapes story information from the compact-view and adds links to self-comments on them
	console.log("Adding comment links");
	
	var stories = new Array(); // scraped story information to be saved
	
	var items = document.querySelectorAll("div.story-card");
	var words = 0;
	for(var i = 0; i < items.length; i++) {
		var item = items[i];
		var link = item.querySelector("a.story_link");
		var info = item.querySelector("span.info");
		var story = {
			id: /\/story\/([0-9]*)/.exec(link.href)[1],
			title: link.firstChild.data,
			author: item.querySelector("span.by a").firstChild.data,
			wordcount: parseInt(info.firstChild.data.split(" ")[0].replace(/,/g, "")),
			ratings: {
				up: parseInt(item.querySelector("i.fa-thumbs-up").nextSibling.data.replace(/,/g, "")),
				down: parseInt(item.querySelector("i.fa-thumbs-down").nextSibling.data.replace(/,/g, ""))
			},
			tags: {
				category: [catLink.title for(catLink of item.querySelectorAll("a.story_category"))],
				character: [charLink.title for(charLink of item.querySelectorAll("div.character-icons a"))]
			},
			// we check to see if the bookshelf id is in our bookshelf menu
			tracking: document.querySelector("div.menu_list.bookshelves li[data-id='" + (/.*\/bookshelf\/([0-9]*)\/favourites/.exec(document.URL)||[0, 0])[1] + "']") != null,
			read_later: document.querySelector("div.menu_list.bookshelves li[data-id='" + (/.*\/bookshelf\/([0-9]*)\/read-it-later/.exec(document.URL)||[0, 0])[1] + "']") != null
		};
		// cull properties we're not sure about (a story appearing in one list does not imply it is not in another)
		if(!story.tracking) delete story.tracking;
		if(!story.read_later) delete story.read_later;
		// finalize data
		stories.push(story);
		words += story.wordcount;
		console.log(JSON.stringify(story));
		
		// fetch all the comments for this story id
		db.getKeysByIndex("comments", "location", "story/" + story.id, function(insertDiv, story) { return function(keys) {
			if(keys.length) console.log("Found " + keys.length + " comments for story/" + story.id);
			// insert comment links
			for(var cid of keys) {
				var link = document.createElement("span");
				//comment type must be set
				link.setAttribute("class", "comment");
				link.setAttribute("data-type", "0");
				link.innerHTML = '<a class="comment_quote_link" href="/story/' + 
					story.id + '#comment/' + 
					cid + '" data-comment_id="' + 
					cid + '">&gt;&gt;' + cid + 
					'<span class="comment_id" style="display:none;">' + 
					cid + '</span></a>';
				link.style.marginLeft = link.style.marginRight = "5px";
				link.style.fontSize = "0.7em";
				insertDiv.appendChild(link);
			}
			db.getItem("stories", story.id, function(remote_story) {
				var up = insertDiv.querySelector("i.fa-thumbs-up");
				var down = insertDiv.querySelector("i.fa-thumbs-down");
				if(remote_story.my_rating > 0) {
					up.style = "color:#83C328";
					up.classList.add("like");
				}else if(remote_story.my_rating < 0) {
					down.style = "color:#C32828";
					down.classList.add("dislike");
				}
			});
		};}(item, story));
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
		</div>\
	';
	// why did I do this instead of just put the resource url in the href attribute?
	element.querySelector("a#viewStories").addEventListener("click", function(event) {
		var win = winMed.getMostRecentWindow("navigator:browser");
		win.gBrowser.selectedTab = win.gBrowser.addTab("resource://fimfic-res/story_list.html");
	}, false);
	document.body.appendChild(element.firstElementChild);
}

function scrapeStories(document, observed) {
	// scrapes information from full-size story boxes
	// set up an observer to re-call this function if any of the stories we scrape changes it's attributes
	if(!observed) var obs = new document.defaultView.MutationObserver(function(muts) { scrapeStories(document, true) });
	var stories = new Array();
	// this is now present on chapter pages, we must be a little more specific
	// chapter pages precede the story_container with a chapter-header, among other things
	var items = document.querySelectorAll("div.story_container:first-child");
	for(var i = 0; i < items.length; i++) {
		var item = items[i];
		var link = item.querySelector("a.story_name");
		var story = {
			id: link.href.split("/")[4],
			title: link.firstChild.data,
			author: item.querySelector("span.author a").firstChild.data,
			wordcount: parseInt(item.querySelector("div.word_count b").firstChild.data.replace(/,/g, "")),
			ratings: {
				up: parseInt(item.querySelector("span.likes").firstChild.data.replace(/,/g, "")),
				down: parseInt(item.querySelector("span.dislikes").firstChild.data.replace(/,/g, ""))
			},
			tags: {
				category: [catLink.firstChild.data for(catLink of item.querySelectorAll("a.story_category"))],
				character: [charLink.title for(charLink of item.querySelectorAll("a.character_icon"))]
			},
			// I should probably come up with a new schema for this, but for now, it's pretty easy to band-aid to use the new default bookshelves
			tracking: item.querySelector("li.bookshelf.selected[title='Favourites']") != null,
			read_later: item.querySelector("li.bookshelf.selected[title='Read It Later']") != null,
			my_rating: item.querySelector("a.like_button_selected") ? 1 : item.querySelector("a.dislike_button_selected") ? -1 : 0,
			created: new Date(item.querySelectorAll("span.date_approved span")[1].firstChild.data.replace(/([0-9]*).. ([^ ]*) (.*)/, "\$2 \$1 \$3")),
			updated: new Date(item.querySelectorAll("span.last_modified span")[1].firstChild.data.replace(/([0-9]*).. ([^ ]*) (.*)/, "\$2 \$1 \$3"))
		};
		console.log(JSON.stringify(story));
		stories.push(story);
		if(!observed) {
			obs.observe(item.querySelector("li.bookshelf[title='Favourites']"), {attributes: true});
			obs.observe(item.querySelector("li.bookshelf[title='Read It Later']"), {attributes: true});
			obs.observe(item.querySelector("a.like_button"), {attributes: true});
			obs.observe(item.querySelector("a.dislike_button"), {attributes: true});
		}
	}
	if(stories.length) {
		var db = new FFDB("fimcomments-db", function() {
			db.updateItems("stories", stories, function() {
				console.log("Updated " + stories.length + " story records");
				db.close();
			});
		}, "resource://fimfic-res/");
	}
}