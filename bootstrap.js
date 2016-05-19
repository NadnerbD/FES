// No bullshit, just what's necessary to actually make shit work
var console = Components.utils.import("resource://gre/modules/devtools/Console.jsm", {}).console;
var ioServ = Components.classes["@mozilla.org/network/io-service;1"].createInstance(Components.interfaces.nsIIOService);
var resHandler = ioServ.getProtocolHandler("resource").QueryInterface(Components.interfaces.nsIResProtocolHandler);
var obsServ = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
var winMed = Components.classes['@mozilla.org/appshell/window-mediator;1'].getService(Components.interfaces.nsIWindowMediator);
Components.utils.import("resource://gre/modules/osfile.jsm");
Components.utils.importGlobalProperties(["TextEncoder", "TextDecoder"]);

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
			case "PickFile":
				var filePicker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
				filePicker.init(e.source, e.data.title, [filePicker.modeOpen, filePicker.modeSave][e.data.saveFile]);
				filePicker.appendFilters(filePicker.filterAll);
				if(e.data.fileType) {
					filePicker.appendFilter(e.data.fileType.title, e.data.fileType.filter);
				}
				filePicker.open(function() {
					e.source.postMessage({
						request: "PickedFile",
						title: e.data.title,
						// file can be null if the user didn't actually pick a file
						filePath: filePicker.file ? filePicker.file.path : null
					}, "resource://fimfic-res");
				});
			break;
			case "WriteFile":
				var encoder = new TextEncoder();
				var dataArray = encoder.encode(e.data.data);
				OS.File.writeAtomic(e.data.name, dataArray, {tmpPath: e.data.name + ".tmp"}).then(
					function () {
						e.source.postMessage({
							request: "FileWritten",
							name: e.data.name
						}, "resource://fimfic-res");
					}
				);
			break;
			case "ReadFile":
				OS.File.read(e.data.name).then(
					function (dataArray) {
						var decoder = new TextDecoder();
						e.source.postMessage({
							request: "FileRead",
							name: e.data.name,
							data: decoder.decode(dataArray)
						}, "resource://fimfic-res");
					}
				);
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
		var title_html = "\
			<div class=\"banner-buttons\">\n\
				<a id=\"source_link\" href=\"\">Source</a>	\n\
				<a href=\"javascript:void(0);\" onclick=\"ResetBanner( );\">Reset Selection</a>	\n\
				<a href=\"\">Banner Selector</a>\n\
			</div>\n\
			<a href=\"http://www.fimfiction.net/\" class=\"home_link\">\n\
				<div>\n\
					<img src=\"resource://fimfic-res/logo_fix.png\">\n\
				</div>\n\
			</a>\n\
			<a href=\"http://www.fimfiction.net/\" class=\"home_link_link\"></a>\n\
			\n\
			<div class=\"theme_selector theme_selector_left\">\n\
				<a href=\"javascript:void();\" onclick=\"selectPreviousTheme( );\"></a>\n\
			</div>\n\
			<div class=\"theme_selector theme_selector_right\">\n\
				<a href=\"javascript:void();\" onclick=\"selectNextTheme( );\"></a>\n\
			</div>\n\
		";
		var title_element = document.createElement("div");
		title_element.className = "title";
		title_element.id = "title";
		title_element.style = "display: block !important;";
		title_element.innerHTML = title_html;
		header_element = document.querySelector("header.header");
		header_element.insertBefore(title_element, header_element.firstChild);
		// we also need to set a variable, and adding a script tag to the above innerHTML doesn't work
		var inject_script = document.createElement("script");
		inject_script.innerHTML = "\n\
			if(getCookie(\"selected_theme\")) {\n\
				// if there is a selected theme, find and display it\n\
				var theme_id = getCookie(\"selected_theme\");\n\
				for(var theme_index in banners) {\n\
					if(banners[theme_index].id == theme_id) {\n\
						theme = theme_index;\n\
						selectTheme(theme);\n\
						break;\n\
					}\n\
				}\n\
			}else{\n\
				// otherwise display a random theme\n\
				theme = Math.floor(Math.random() * banners.length);\n\
				selectTheme(theme);\n\
				ResetBanner();\n\
			}\n\
		";
		document.head.appendChild(inject_script);
		// and finally some css to fix the user bar
		var inject_css = document.createElement("style");
		inject_css.innerHTML = "\
		.user_toolbar > ul {\n\
			background-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.0) 0%, rgba(0, 0, 0, 0.2) 100%);\n\
			border-bottom-right-radius: 5px;\n\
			border-bottom-left-radius: 5px;\n\
		}\n\
		.user_toolbar > ul > li {\n\
			background-image: none;\n\
			background-color: rgba(255, 255, 255, 0.2);\n\
			text-shadow: 1px 1px rgba(255, 255, 255, 0.2);\n\
			border-right: 1px solid rgba(0, 0, 0, 0.2);\n\
		}\n\
		.user_toolbar > ul > li:hover {\n\
			background-image: none;\n\
			background-color: rgba(255, 255, 255, 0.4);\n\
			text-shadow: 1px 1px rgba(255, 255, 255, 0.2);\n\
		}\n\
		.user_toolbar > ul > li:first-of-type {\n\
			border-left: 1px solid rgba(0, 0, 0, 0.2);\n\
		}\n\
		header.header {\n\
			max-width: 1300px;\n\
			width: 98%;\n\
		}\n\
		";
		document.head.appendChild(inject_css);
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
				var infoLinks = ci.querySelectorAll("div.comment_information div:first-child > a");
				if(infoLinks.length == 3) {
					comment.chapter = parseInt(infoLinks[2].href.split("/")[5]);
				}else{
					comment.chapter = 1;
				}
			}
			if(comment.id != "0") {
				// for the love of god stop scraping the comment preview
				commentList.push(comment);
				console.log("Scraped comment " + comment.id);
			}
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
	getBookshelves(document);
}

function getBookshelves(document) {
	var links = document.querySelectorAll("nav ul.bookshelves > li > a[href]");
	var shelves = [];
	for(var link of links) {
		var shelf = {
			name: link.childNodes[1].data,
			id: link.href.split("/")[4],
			icon_type: link.childNodes[0].getAttribute("data-icon-type")
		};
		if(shelf.icon_type == "font-awesome") {
			shelf.icon_data = JSON.parse(document.defaultView.getComputedStyle(link.childNodes[0], ":before").content);
		}else if(shelf.icon_type == "pony-emoji") {
			shelf.icon_data = link.childNodes[0].childNodes[0].childNodes[0].data;
		}else{
			console.log("Unrecognised icon type: " + shelf.icon_type);
		}
		shelves.push(shelf);
	}
	console.log(JSON.stringify(shelves));
	var db = new FFDB("fimcomments-db", function() {
		db.putItems("bookshelves", shelves, function() {
			console.log("Updated bookshelf list");
		});
	}, "resource://fimfic-res/");
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
				category: [for(catLink of item.querySelectorAll("a.story_category")) catLink.title],
				character: [for(charLink of item.querySelectorAll("div.character-icons a")) charLink.title]
			},
			bookshelves: {}
		};
		// if we're viewing a bookshelf page, add the relevant bookshelf property to the story
		var shelfInfo = /.*\/bookshelf\/([0-9]*)\/([^?]*).*/.exec(document.URL)
		if(shelfInfo && document.querySelector(".bookshelves li a[href='\/bookshelf\/" + shelfInfo[1] + "\/" + shelfInfo[2] + "']")) {
			// we check to see if the bookshelf id is in our bookshelf menu
			story.bookshelves[shelfInfo[1]] = true;
		}
		// cover for the fact that some story cards don't include character information
		if(story.tags.character.length == 0) {
			delete story.tags.character;
		}
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
	var items = document.querySelectorAll("div.story_container");
	// the story_container element is now present on chapter pages
	// if we're on one we need to abort because important info we want is not present
	if(!items.length || items[0].querySelector("span.last_modified") == null) {
		console.log("Aborting story scrape, chapter page");
		return;
	}
	for(var i = 0; i < items.length; i++) {
		var item = items[i];
		var link = item.querySelector("a.story_name");
		var story = {
			id: link.href.split("/")[4],
			title: link.firstChild.data,
			author: item.querySelector(".author a").firstChild.data,
			wordcount: parseInt(item.querySelector("div.word_count b").firstChild.data.replace(/,/g, "")),
			ratings: {
				up: parseInt((item.querySelector("span.likes").firstChild||{data:"0"}).data.replace(/,/g, "")),
				down: parseInt((item.querySelector("span.dislikes").firstChild||{data:"0"}).data.replace(/,/g, ""))
			},
			tags: {
				category: [for(catLink of item.querySelectorAll("a.story_category")) catLink.firstChild.data],
				character: [for(charLink of item.querySelectorAll("a.character_icon")) charLink.title]
			},
			bookshelves: {},
			my_rating: item.querySelector("a.like_button_selected") ? 1 : item.querySelector("a.dislike_button_selected") ? -1 : 0,
			updated: new Date(item.querySelectorAll("span.last_modified span")[1].firstChild.data.replace(/([0-9]*).. ([^ ]*) (.*)/, "\$2 \$1 \$3"))
		};
		// add bookshelf properties
		for(var shelf of item.querySelectorAll("li.bookshelf")) {
			if(!shelf.classList.contains("show-bookshelves-popup")) {
				story.bookshelves[shelf.getAttribute("data-bookshelf")] = shelf.classList.contains("selected");
			}
		}
		var creationSpans = item.querySelectorAll("span.date_approved span");
		if(creationSpans.length) {
			// It's possible to view stories that have not yet been approved; These will have no "creation date"
			story.created = new Date(creationSpans[1].firstChild.data.replace(/([0-9]*).. ([^ ]*) (.*)/, "\$2 \$1 \$3"));
		}
		console.log(JSON.stringify(story));
		stories.push(story);
		if(!observed) {
			for(var shelf of item.querySelectorAll("li.bookshelf")) {
				obs.observe(shelf, {attributes: true});
			}
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

