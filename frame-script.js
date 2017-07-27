var console = Components.utils.import("resource://gre/modules/Console.jsm", {}).console;
Components.utils.import("resource://fimfic-res/idb-wrapper.js");

// listen for uid message
addMessageListener("FimfictionEnhancementSuite@nadnerb.net:uid", setUid);

// we need to listen for a shutdown message so that we can stop handling new pages and messages
addMessageListener("FimfictionEnhancementSuite@nadnerb.net:shutdown", removeFrameListeners);

// listen for incoming responses from the chrome script
addMessageListener("FimfictionEnhancementSuite@nadnerb.net:chrome-response", chromeMessageForwarder);

// listen for new content being loaded in this tab
addEventListener("DOMContentLoaded", handleNewPage, false);

// listen for postMessage events directed at the window
content.addEventListener("message", postMessageForwarder, false, true);

// set our uid
var uid;
function setUid(message) {
	uid = message.data.uid;
	removeMessageListener("FimfictionEnhancementSuite@nadnerb.net:uid", setUid);
	console.log("FES: frame-script started (" + uid + ")");
}

// run when the script is shut down
function removeFrameListeners(message) {
	if(message.data.uid != uid) return;
	console.log("FES: frame-script received shutdown request (" + uid + ")");
	removeEventListener("DOMContentLoaded", handleNewPage);
	content.removeEventListener("message", postMessageForwarder);
	removeMessageListener("FimfictionEnhancementSuite@nadnerb.net:chrome-response", chromeMessageForwarder);
	removeMessageListener("FimfictionEnhancementSuite@nadnerb.net:shutdown", removeFrameListeners);
}

// forwards messages from extension content to the chrome script
function postMessageForwarder(event) {
	// ensure that the message actually came from an extension page
	if(!(event.origin == "resource://fimfic-res" || event.origin == "null")) return;
	//console.log("DEBUG: postMessage received from content at", event.origin);
	// pass on the message to the chrome script
	var msg = event.data;
	// event.origin is "null" if the message was posted from a file: uri, and returning the message requires
	// that we post it to "*", which allows the message to be received by any tab. Use from file with extreme caution!
	// see https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage "Using window.postMessage in extensions"
	msg.origin = event.origin == "null" ? "*" : event.origin;
	sendAsyncMessage("FimfictionEnhancementSuite@nadnerb.net:chrome-request", msg);
}

// forwards messages from the chrome script to the extension content
function chromeMessageForwarder(message) {
	content.postMessage(message.data, message.data.origin);
}

var locs = [
	// story-card elements can appear in a lot of places
	[/^https?:\/\/(?:www\.)?fimfiction\.net\/(?:index\.php\?view=category|stories|bookshelf|user)/, linkComments],
	[/^https?:\/\/(?:www\.)?fimfiction\.net\/story\//, watchComments],
	[/^https?:\/\/(?:www\.)?fimfiction\.net/, changeHeader]
];
	
function handleNewPage(event) {
	// listen for postMessage events directed at the window
	// we need to reapply this listener when the page is reloaded
	content.addEventListener("message", postMessageForwarder, false, true);
	// do further per-page init for documents that match the location list
	var document = event.target;
	for(var i in locs) {
		// iframes for some inexplicable reason can have the URL property of their parent
		// document, so we must check that the document is not iframe content before proceeding
		if(locs[i][0].test(document.URL) && !document.defaultView.frameElement) {
			locs[i][1](document);
		}
	}
}

function changeHeader(document) {
	// yes I'm petty
	try {
		// we'll be replacing it, so remove the home link
		var home_link = document.querySelector("li#home_link");
		home_link.parentNode.removeChild(home_link);
		// new html to be inserted into the header
		var title_html = `
			<div id="title" class="title">
				<div class="banner-buttons">
					<a id="source_link" href="">Source</a>
					<a href="javascript:void(0);" onclick="ResetBanner( );">Reset Selection</a>
					<a href="">Banner Selector</a>
				</div>
				<a href="http://www.fimfiction.net/" class="home_link">
					<div>
						<img src="resource://fimfic-res/logo_fix.png">
					</div>
				</a>
				<a href="http://www.fimfiction.net/" class="home_link_link"></a>
				<div class="theme_selector theme_selector_left">
					<a href="javascript:void();" onclick="selectPreviousTheme( );"></a>
				</div>
				<div class="theme_selector theme_selector_right">
					<a href="javascript:void();" onclick="selectNextTheme( );"></a>
				</div>
			</div>
		`;
		var header_element = document.createElement("header");
		header_element.className = "header";
		header_element.innerHTML = title_html;
		var user_toolbar_element = document.querySelector("nav.user_toolbar");
		user_toolbar_element.parentNode.insertBefore(header_element, user_toolbar_element);
		header_element.appendChild(user_toolbar_element);
		// we also need to set a variable, and adding a script tag to the above innerHTML doesn't work
		var inject_script = document.createElement("script");
		inject_script.innerHTML = `
			if(getCookie("selected_theme")) {
				// if there is a selected theme, find and display it
				var theme_id = getCookie("selected_theme");
				for(var theme_index in banners) {
					if(banners[theme_index].id == theme_id) {
						theme = theme_index;
						selectTheme(theme);
						break;
					}
				}
			}else{
				// otherwise display a random theme
				theme = Math.floor(Math.random() * banners.length);
				selectTheme(theme);
				ResetBanner();
			}
			/* scripts from the fimfiction package */
			function setCookie(a, b, c) {
				var d = new Date;
				d.setTime(d.getTime() + 864E5 * c);
				b = escape(b);
				document.cookie = a + "=" + b + (c ? ";expires=" + d.toUTCString() : "") + ";path=/"
			}
			function delCookie(a) {
				document.cookie = a + "=null;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/"
			}
			function selectNextTheme() {
				theme++;
				theme > banners.length - 1 && (theme = 0);
				selectTheme(theme)
			}
			function selectPreviousTheme() {
				theme--;
				0 > theme && (theme = banners.length - 1);
				selectTheme(theme)
			}
			function selectTheme(a) {
				setCookie("selected_theme", banners[a].id, 365);
				document.querySelector("#title a.home_link").style.backgroundImage = "url('" + banners[a].url + "')";
				if(banners[a][2] == "") {
					document.querySelector("#source_link").classList.add("hidden")
				}else{
					document.querySelector("#source_link").setAttribute("href", banners[a].source);
					document.querySelector("#source_link").classList.remove("hidden");
				}
				if("colour" in banners[a]) {
					document.querySelector(".user_toolbar > ul").style.backgroundColor = banners[a].colour;
				}
			}
			function ResetBanner() {
				delCookie("selected_theme")
			}
			var banners = [{
					colour : "rgb(164, 110, 60)",
					url : "//static.fimfiction.net/images/custom_banners/zecora.jpg?2",
					source : "http://aeronjvl.deviantart.com/art/Hanging-by-the-Edge-327757722",
					id : "zecora"
				}, {
					colour : "rgb(164, 122, 60)",
					url : "//static.fimfiction.net/images/custom_banners/aeron_fluttershy.jpg?2",
					source : "http://aeronjvl.deviantart.com/art/Nature-326303180",
					id : "aeron_fluttershy"
				}, {
					colour : "rgb(76, 112, 126)",
					url : "//static.fimfiction.net/images/custom_banners/aeron_philomena.jpg?2",
					source : "http://ajvl.deviantart.com/art/Philomena-Equestria-s-Finest-Phoenix-310217164",
					id : "aeron_philomena"
				}, {
					colour : "rgb(76, 126, 110)",
					url : "//static.fimfiction.net/images/custom_banners/aeron_celestia.jpg?2",
					source : "http://aeronjvl.deviantart.com/art/Path-to-Canterlot-340639474",
					id : "aeron_celestia"
				}, {
					colour : "rgb(87, 102, 111)",
					url : "//static.fimfiction.net/images/custom_banners/derpy_dash.jpg?2",
					source : "http://ponykillerx.deviantart.com/art/Full-Armour-D-vs-D-288729315",
					id : "derpy_dash"
				}, {
					colour : "rgb(83, 76, 121)",
					url : "//static.fimfiction.net/images/custom_banners/ponykiller_trixie.jpg?2",
					source : "http://ponykillerx.deviantart.com/art/No-Title-Wallpaper-Version-287646346",
					id : "ponykiller_trixie"
				}, {
					colour : "rgb(140, 151, 83)",
					url : "//static.fimfiction.net/images/custom_banners/yamio_fluttershy.jpg?2",
					source : "http://yamio.deviantart.com/art/Fluttershy-285372865",
					id : "yamio_fluttershy"
				}, {
					colour : "rgb(146, 164, 60)",
					url : "//static.fimfiction.net/images/custom_banners/ratofdrawn_1.jpg?2",
					source : "http://ratofdrawn.deviantart.com/art/Wet-Fun-317158001",
					id : "ratofdrawn_1"
				}, {
					colour : "rgb(100, 133, 190)",
					url : "//static.fimfiction.net/images/custom_banners/ratofdrawn_rarijack.jpg?2",
					source : "http://ratofdrawn.deviantart.com/art/Differences-343226962",
					id : "ratofdrawn_rarijack"
				}, {
					colour : "rgb(72, 60, 164)",
					url : "//static.fimfiction.net/images/custom_banners/solar_luna.jpg?2",
					source : "http://soapie-solar.deviantart.com/art/Chibi-Luna-Star-Fishing-340002341",
					id : "solar_luna"
				}, {
					colour : "rgb(131, 164, 60)",
					url : "//static.fimfiction.net/images/custom_banners/solar_group.jpg?2",
					source : "http://soapie-solar.deviantart.com/art/Forest-Foundation-283012970",
					id : "solar_group"
				}, {
					colour : "rgb(164, 135, 60)",
					url : "//static.fimfiction.net/images/custom_banners/uc77_1.jpg?2",
					source : "http://uc77.deviantart.com/art/Ponies-Dig-Giant-Robots-281071953",
					id : "uc77_1"
				}, {
					colour : "rgb(77, 60, 164)",
					url : "//static.fimfiction.net/images/custom_banners/cmaggot_fluttershy.jpg?2",
					source : "http://cmaggot.deviantart.com/art/Dangerous-Mission-342068171",
					id : "cmaggot_fluttershy"
				}, {
					colour : "rgb(164, 114, 60)",
					url : "//static.fimfiction.net/images/custom_banners/rainbow_ss.jpg?2",
					source : "http://derpiboo.ru/41558",
					id : "rainbow_ss"
				}, {
					colour : "rgb(69, 100, 96)",
					url : "//static.fimfiction.net/images/custom_banners/rainbow_markerpone.jpg?2",
					source : "http://derpiboo.ru/131068",
					id : "rainbow_markerpone"
				}, {
					colour : "rgb(164, 60, 152)",
					url : "//static.fimfiction.net/images/custom_banners/rainbow_roseluck.jpg?2",
					source : "http://derpiboo.ru/50361",
					id : "rainbow_roseluck"
				}, {
					colour : "rgb(60, 114, 164)",
					url : "//static.fimfiction.net/images/custom_banners/jj_trixie.jpg?2",
					source : "http://johnjoseco.deviantart.com/art/Trixie-s-Life-is-so-Hard-340685374",
					id : "jj_trixie"
				}, {
					colour : "rgb(60, 118, 164)",
					url : "//static.fimfiction.net/images/custom_banners/anima_1.jpg?2",
					source : "http://spiritto.deviantart.com/art/C-mon-lift-your-Spirit-324914801",
					id : "anima_1"
				}, {
					colour : "rgb(60, 147, 164)",
					url : "//static.fimfiction.net/images/custom_banners/mew_pinkie.jpg?2",
					source : "http://mewball.deviantart.com/art/Reflect-338427890",
					id : "mew_pinkie"
				}, {
					colour : "rgb(60, 89, 164)",
					url : "//static.fimfiction.net/images/custom_banners/tsitra_dash.jpg?2",
					source : "http://tsitra360.deviantart.com/art/Morning-Flight-331710988",
					id : "tsitra_dash"
				}, {
					colour : "rgb(164, 127, 60)",
					url : "//static.fimfiction.net/images/custom_banners/knifeh_scoots.jpg?2",
					source : "http://knifeh.deviantart.com/art/Scootaloo-326771443",
					id : "knifeh_scoots"
				}, {
					colour : "rgb(164, 89, 60)",
					url : "//static.fimfiction.net/images/custom_banners/noben_celestia.jpg?2",
					source : "http://noben.deviantart.com/art/Sunrise-in-Equestria-280309698",
					id : "noben_celestia"
				}, {
					colour : "rgb(77, 60, 164)",
					url : "//static.fimfiction.net/images/custom_banners/ep_shady_trough.jpg?2",
					source : "http://equestria-prevails.deviantart.com/art/The-Shady-Trough-319986368",
					id : "ep_shady_trough"
				}, {
					colour : "rgb(60, 85, 164)",
					url : "//static.fimfiction.net/images/custom_banners/spittfire_1.jpg?2",
					source : "http://spittfireart.deviantart.com/art/The-Report-Commission-340421670",
					id : "spittfire_1"
				}, {
					colour : "rgb(75, 77, 85)",
					url : "//static.fimfiction.net/images/custom_banners/blitzpony_luna.jpg?2",
					source : "http://blitzpony.deviantart.com/art/S-hard-to-say-359899432",
					id : "blitzpony_luna"
				}, {
					colour : "rgb(71, 127, 179)",
					url : "//static.fimfiction.net/images/custom_banners/gsphere_scoots.jpg?2",
					source : "http://lionel23.deviantart.com/art/The-Newbie-set-an-Academy-Record-356826950",
					id : "gsphere_scoots"
				}, {
					colour : "rgb(112, 108, 167)",
					url : "//static.fimfiction.net/images/custom_banners/stoic_celestia.jpg?2",
					source : "http://thestoicmachine.deviantart.com/art/Radiant-Malevolence-213959523",
					id : "stoic_celestia"
				}, {
					colour : "rgb(134, 125, 88)",
					url : "//static.fimfiction.net/images/custom_banners/moe_canterlot.jpg?2",
					source : "http://derpibooru.org/25",
					id : "moe_canterlot"
				}, {
					colour : "rgb(119, 88, 134)",
					url : "//static.fimfiction.net/images/custom_banners/alasou_costumes.jpg?2",
					source : "http://alasou.deviantart.com/art/Costume-Swap-party-381670764",
					id : "alasou_costumes"
				}, {
					colour : "rgb(82, 90, 143)",
					url : "//static.fimfiction.net/images/custom_banners/pridark_luna.jpg?2",
					source : "http://pridark.deviantart.com/art/A-Wonderful-Night-381504014",
					id : "pridark_luna"
				}, {
					colour : "rgb(165, 87, 68)",
					url : "//static.fimfiction.net/images/custom_banners/gign_flutterdash.jpg?2",
					source : "http://gign-3208.deviantart.com/art/In-the-attic-377732207",
					id : "gign_flutterdash"
				}, {
					colour : "rgb(85, 107, 128)",
					url : "//static.fimfiction.net/images/custom_banners/goben_forest.jpg?2",
					source : "http://noben.deviantart.com/art/Giggling-at-the-Ghosties-356451219",
					id : "goben_forest"
				}, {
					colour : "rgb(104, 136, 90)",
					url : "//static.fimfiction.net/images/custom_banners/devinian_lyra_bonbon.jpg?2",
					source : "http://devinian.deviantart.com/art/Story-of-the-bench-373750983",
					id : "devinian_lyra_bonbon"
				}, {
					colour : "rgb(116, 145, 66)",
					url : "//static.fimfiction.net/images/custom_banners/devinian_fluttershy.jpg?2",
					source : "http://devinian.deviantart.com/art/Picnic-with-Kindness-351639714",
					id : "devinian_fluttershy"
				}, {
					colour : "rgb(69, 132, 182)",
					url : "//static.fimfiction.net/images/custom_banners/jackalynn_pinkiedash.jpg?2",
					source : "http://jack-a-lynn.deviantart.com/art/Following-the-Rainbow-288432950",
					id : "jackalynn_pinkiedash"
				}, {
					colour : "#5e7520",
					url : "//static.fimfiction.net/images/custom_banners/yakovlev_fluttershy.jpg?2",
					source : "http://yakovlev-vad.deviantart.com/art/Simple-curiosity-468468925",
					id : "yakovlev_fluttershy"
				}, {
					colour : "#9e75a9",
					url : "//static.fimfiction.net/images/custom_banners/yakovlev_twilight.jpg?2",
					source : "http://yakovlev-vad.deviantart.com/art/Time-to-wash-3-490390076",
					id : "yakovlev_twilight"
				}, {
					colour : "#77599a",
					url : "//static.fimfiction.net/images/custom_banners/mymagicdream_twilight.jpg?2",
					source : "http://my-magic-dream.deviantart.com/art/Twilight-453477065",
					id : "mymagicdream_twilight"
				}
			];
		`;
		document.head.appendChild(inject_script);
		// and finally some css to fix the user bar
		var inject_css = document.createElement("style");
		inject_css.innerHTML = `
			div#title {
				height: 175px;
				background-position: center top;
				background-repeat: no-repeat;
				position: relative;
			}
			.user_toolbar {
				background: none;
				box-shadow: none;
				border: none;
			}
			.user_toolbar > ul > li::before {
				right: 0;
				background: linear-gradient(to bottom, #ffffff00 0%, #ffffff33 50%, #ffffff00 100%);
			}
			.user_toolbar > ul > li::after {
				right: -1px;
				background: linear-gradient(to bottom, #00000000 0%, #00000033 50%, #00000000 100%);
			}
			.user_toolbar > ul {
				border-radius: 0px 0px 5px 5px;
				border: 1px solid #00000033;
				border-top: none;
				box-shadow: 0px 1px #ffffff33 inset;
				text-align: center;
				padding-left: 0px;
				width: 100%;
			}
			.user_toolbar > ul > li {
				text-shadow: -1px -1px #00000033;
				color: #e0e0e0;
			}
			.user_toolbar > ul > li:hover {
				text-shadow: -1px -1px #00000033;
				background-color: #ffffff33;
			}
			header.header {
				max-width: 1300px;
				width: 98%;
				margin-left: auto;
				margin-right: auto;
				position: relative;
			}
			header.header .title {
				height: 175px;
				background-position: center top;
				background-repeat: no-repeat;
				position: relative;
			}
			header.header .home_link div {
				position: absolute;
				left: 50%;
			}
			header.header .home_link div img {
				margin-left: -500px;
			}
			header.header .theme_selector {
				width: 120px;
				height: 100%;
				position: absolute;
				z-index: 11;
				transition: background 0.3s;
				background: transparent;
				background: linear-gradient(to right, transparent 0%, transparent 100%);
			}
			header.header .theme_selector_right:hover {
				background: transparent;
				background: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.3) 100%);
			}
			header.header .theme_selector_left:hover {
				background: transparent;
				background: linear-gradient(to right, rgba(0,0,0,0.3) 0%, transparent 100%);
			}
			header.header .theme_selector a {
				color: #fff;
				position: absolute;
				height: 100%;
				width: 60px;
				opacity: 0;
				text-align: center;
				line-height: 175px;
				text-decoration: none;
				text-shadow: 0px 2px rgba(0,0,0,0.5),0px 0px 50px #000;
				font-size: 32px;
				transition: opacity 0.3s;
			}
			header.header:hover .theme_selector a {
				opacity: 1;
			}
			header.header .theme_selector_left, header.header .theme_selector_left a {
				left: 0px;
			}
			header.header .theme_selector_right, header.header .theme_selector_right a {
				right: 0px;
			}
			header.header .theme_selector_right a::before {
				font-family: "FontAwesome";
				content: "\\f054";
			}
			header.header .theme_selector_left a::before {
				font-family: "FontAwesome";
				content: "\\f053";
			}
			header.header .home_link_link {
				display: block;
				position: absolute;
				z-index: 10;
				right: 0px;
				left: 0px;
				top: 0px;
				bottom: 0px;
			}
			header.header .home_link {
				display: block;
				position: absolute;
				border: 1px solid rgba(0,0,0,0.2);
				border-top: none;
				border-bottom: none;
				right: 0px;
				left: 0px;
				top: 0px;
				bottom: 0px;
				background-position: -1px 0px;
				background-position: center top;
				overflow: hidden;
				transition: background-image 0.15s;
			}
			header.header .banner-buttons {
				position: absolute;
				z-index: 30;
				visibility: hidden;
				opacity: 0;
				transition: opacity 0.2s, visibility 0.2s;
				right: 64px;
				bottom: 10px;
			}
			header.header:hover .banner-buttons {
				visibility: visible;
				opacity: 1;
			}
			header.header .banner-buttons a {
				background-color: rgba(0,0,0,0.7);
				color: rgba(255,255,255,0.8);
				font-size: 0.7em;
				padding: 5px 10px;
				text-decoration: none;
				border-radius: 3px;
				border: 1px solid rgba(0,0,0,0.3);
				box-shadow: 0px 1px 0px rgba(255,255,255,0.2) inset;
				font-family: "Segoe UI";
				text-shadow: 1px 1px rgba(0,0,0,0.3);
			}
			header.header .banner-buttons a:hover {
				background-color: rgba(0,0,0,0.9);
			}
		`;
		document.head.appendChild(inject_css);
		/* character tag replacement */
		var char_style = document.createElement("link");
		char_style.rel = "stylesheet";
		char_style.type = "text/css";
		char_style.href = "resource://fimfic-res/characters/characters.css";
		document.head.appendChild(char_style);
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
		// the comment will only have an edit button if we own it
		if(ci.querySelectorAll(".buttons a[title=\"Edit this comment\"]").length) {
			var likes, dislikes;
			var likeSpan = ci.querySelector("span.like-text");
			if(likeSpan == null || likeSpan.firstChild == null) likes = 0; else likes = parseInt(likeSpan.firstChild.data.replace(/,/g, ""));
			var dislikeSpan = ci.querySelector("span.dislike-text");
			if(dislikeSpan == null || dislikeSpan.firstChild == null) dislikes = 0; else dislikes = parseInt(dislikeSpan.firstChild.data.replace(/,/g, ""));
			var comment = {
				author: ci.getAttribute("data-author"),
				id: ci.getAttribute("data-comment_id"),
				// the old format date: ci.getElementsByTagName("span")[2].title,
				// the fix: new Date(orig.replace(/[^ ]* ([0-9]*).. of ([^ ]*) (.*)/, "\$2 \$1 \$3"));
				date: (function (ci) {
					if(ci.querySelector("div.meta span[data-time]")) {
						return new Date(parseInt(ci.querySelector("div.meta span[data-time]").getAttribute("data-time")) * 1000);
					}else{
						var t = /([A-z]{3})[A-z]* ([0-9]{1,2})[a-z]{2} of ([A-z]{3})[A-z]* ([0-9]*) @([0-9]*):([0-9]*)([a-z]{2})/.exec(ci.querySelector("div.meta span[title]").getAttribute("title"));
						return new Date(t[1]+" "+t[3]+" "+t[2]+" "+t[4]+" "+(t[7]=="pm"?parseInt(t[5])+12:t[5])+":"+t[6]+":00 "+/GMT-[0-9]{4}/.exec(Date())[0]);
					}
				}(ci)),
				ratings: {
					up: likes,
					down: dislikes
				},
				location: commentLocation
			};
			comment.data = function (comment, ci) { // initiate async loading of comment data
				var ctype = ci.getAttribute("data-type"); // NOTE: our storage assumes this will always be the same
				var req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();
				req.open("GET", document.location.origin + "/ajax/comments/" + ctype + "/" + comment.id + "/edit", true);
				req.onload = function() {
					var elem = document.createElement("div");
					elem.innerHTML = JSON.parse(req.response).content;
					comment.data = elem.querySelector("textarea").value;
					console.log("Received data for comment " + comment.id);
					commentLoaded();
				}
				req.send();
				return null;
			} (comment, ci);
			if(path.length == 6) {
				// we're on a chapter page
				comment.chapter = parseInt(path[3]);
			}else{
				// if we're on the main page, then the comment has a chapter marker
				// there will be no marker if there is only one chapter
				// we can extract the chapter number from the url
				var infoLink = ci.querySelector("div.comment_information div.meta span.desktop > a:first-of-type");
				if(infoLink) {
					comment.chapter = parseInt(infoLink.href.split("/")[5]);
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
	// check that comments are ready to be saved
	function commentLoaded() {
		for(var comment of commentList) {
			if(comment.data == null) {
				return;
			}
		}
		console.log("Data loaded for " + commentList.length + " comments; saving");
		saveComments();
	}
	// save our work
	function saveComments() {
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
						saveUserAvatar(firstAuthor, document.querySelector("div#comment_" + firstId + " div.author img.avatar").getAttribute("data-src"));
					}
				});
			});
		}, "resource://fimfic-res/"); // this should allow our addon documents to access this database from their local scope
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
				up: parseInt((item.querySelector("i.fa-thumbs-up")||{nextSibling: {data: "0"}}).nextSibling.data.replace(/,/g, "")),
				down: parseInt((item.querySelector("i.fa-thumbs-down")||{nextSibling: {data: "0"}}).nextSibling.data.replace(/,/g, ""))
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
		sendAsyncMessage("FimfictionEnhancementSuite@nadnerb.net:chrome-request", {request: "AddTab", url: "resource://fimfic-res/story_list.html"});
	}, false);
	document.body.appendChild(element.firstElementChild);
}

function scrapeStories(document, observed) {
	// scrapes information from full-size story boxes
	// set up an observer to re-call this function if any of the stories we scrape changes it's attributes
	if(!observed) var obs = new document.defaultView.MutationObserver(function(muts) { scrapeStories(document, true) });
	var stories = new Array();
	// get all the fullsize story elements on the page
	var items = document.querySelectorAll("article.story_container");
	// determine whether we can get the author of the stories
	if(items.length && !items[0].querySelector(".author")) {
		var pageAuthor = document.querySelector(".user-page-header h1 a").firstChild.data;
	}
	for(var i = 0; i < items.length; i++) {
		var item = items[i];
		var link = item.querySelector("a.story_name");
		var story = {
			id: item.getAttribute("data-story"),
			title: link.firstChild.data,
			author: pageAuthor || item.querySelector(".author a").firstChild.data,
			wordcount: parseInt(item.querySelector("div.word_count b").firstChild.data.replace(/,/g, "")),
			ratings: {
				up: parseInt((item.querySelector("span.likes").firstChild||{data:"0"}).data.replace(/,/g, "")),
				down: parseInt((item.querySelector("span.dislikes").firstChild||{data:"0"}).data.replace(/,/g, ""))
			},
			tags: {
				category: [for(catLink of item.querySelectorAll("a.tag-genre")) catLink.firstChild.data],
				character: [for(charLink of item.querySelectorAll("a.tag-character")) charLink.title]
			},
			bookshelves: {},
			my_rating: item.querySelector("a.like_button_selected") ? 1 : item.querySelector("a.dislike_button_selected") ? -1 : 0,
			created: new Date(parseInt(item.querySelector("span.approved-date span[data-time]").getAttribute("data-time")) * 1000),
			udpated: new Date(item.querySelector("ul.chapters > li:last-of-type span.date").childNodes[1].data.replace(/ ([0-9]*).. ([^ ]*) (.*)/, "\$2 \$1 \$3"))
		};
		// add bookshelf properties
		for(var shelf of item.querySelectorAll("li.bookshelf")) {
			story.bookshelves[shelf.getAttribute("data-bookshelf")] = shelf.classList.contains("selected");
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

