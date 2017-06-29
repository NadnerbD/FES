function bbcode() {
	/*
		Simple parser designed to transform BBCode into a DOM tree
		
		steps:
			lexing:
				scan for tags, generate tag stream
			parsing/generation:
				generate DOM tree from tag stream
		
		lexing grammar:
			name = "b" | "i" | "u" | "s" | "size" | "color" | "url" | "img" | "quote" | "youtube" | "center" | "right" | "hr" | "spoiler" | "smcaps" | "site_url" | "icon" | "email" | "code" | "indent" | "pre" | "codeblock" | "sub" | "sup" | "em" | "strong" | "list" | "*";
			tag = "[" ("/" name) | (name [ "=" value ]) "]";
			emote = ":" emote_name ":";
			quote_ref = ">>" number;
			close_p = "\n";

		some standard bbcode tags that aren't supported by our target are "font", "ul", and "ol"
		
		we place invalid tags back into the stream as text
		
		procedure for rewriting spans to trees
		[i]a[b]b[u]c[/i]d[/b]e[/u]
		Build tree by walking tag stream. 
		If a tag is closed out of order, close all intervening tags, and reopen them immediately after.
		Skip reopening if there is no child node. 
		<i>
			a
			<b>
			b
				<u>c</u>
			</b>
		</i>
		<b>
			<u>d</u>
		</b>
		<u>e</u>
	*/

	function stringStream(string) {
		var index = 0;
		var mark = 0;
		var next = string[index++];
		function get() {
			next = string[index++];
		}
		this.accept = function(token, caseInsensitive) {
			if((caseInsensitive ? next.toLowerCase() : next) == token) {
				get();
				return true;
			}
			return false;
		}
		this.accept_until = function(tokens) {
			var value = "";
			while(tokens.indexOf(next) == -1 && !empty()) {
				value += next;
				get();
			}
			return value;
		}
		this.expect = function(token) {
			if(next != token) {
				throw "Expected: " + token + " Got: " + next;
			}
			get();
		}
		var empty = this.empty = function() {
			return index > string.length;
		}
		this.mark = function() {
			mark = index - 1;
		}
		this.from_mark = function() {
			return string.substring(mark, index - 1);
		}
		this.peek = function() {
			return next;
		}
		this.read = function() {
			var ret = next;
			get();
			return ret;
		}
	}

	function acceptIdentifiers(stream, tagNames, caseInsensitive) {
		var index = 0;
		var out = "";
		while(true) {
			var nextNames = [];
			// check all names to see if they can be advanced
			for(var tagName = 0; tagName < tagNames.length; tagName++) {
				if(
					(caseInsensitive ? stream.peek().toLowerCase() : stream.peek()) == tagNames[tagName][index] ||
					index == tagNames[tagName].length
				) {
					nextNames.push(tagNames[tagName]);
				}
			}
			// advance the stream
			for(var i = 0; i < nextNames.length; i++) {
				var o = stream.peek();
				if(stream.accept(nextNames[i][index], caseInsensitive)) {
					out += o;
					break;
				}
			}
			if(nextNames.length == 1 && nextNames[0].length == index) {
				// if we've hit the end of a valid name, and it's the only one remaining..
				return out;
			}else if(nextNames.length == 0) {
				// or if we've eliminated all name candidtates
				throw "Invalid tagName";
			}
			tagNames = nextNames;
			index++;
		}
	}

	function tagName(stream) {
		// this is some crazy hax. I wouldn't do this in a parser that could actually
		// complain about invalid input
		var tagNames = ["b", "i", "u", "s", "size", "color", "url", "img", "quote", "youtube", "center", "right", "hr", "spoiler", "smcaps", "site_url", "icon", "email", "code", "indent", "pre", "codeblock", "sub", "sup", "em", "strong", "list", "*"];
		return acceptIdentifiers(stream, tagNames, true);
	}

	var emoteDict = {};
	function emoteName(stream) {
		var emoteNames = [];
		for(key in emoteDict) {
			emoteNames.push(key);
		}
		return acceptIdentifiers(stream, emoteNames);
	}

	function integerString(stream) {
		var nums = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
		var str = "";
		while(stream.peek() in nums) {
			str += stream.read();
		}
		if(str.length == 0) {
			throw "Invalid number";
		}
		return str;
	}

	function tag(stream) {
		stream.mark();
		try {
			this.close = false;
			if(stream.accept("[")) {
				if(stream.accept("/")) {
					this.close = true;
					this.cname = tagName(stream);
				}else{
					this.cname = tagName(stream);
					if(stream.accept("=")) {
						this.value = stream.accept_until(["]"]);
					}
				}
				stream.expect("]");
			}else if(stream.accept(":")) {
				this.cname = "emote";
				this.value = emoteName(stream);
				stream.expect(":");
			}else if(stream.accept(">")) {
				stream.expect(">");
				this.cname = "quote_ref";
				this.value = integerString(stream);
			}else if(stream.accept("\n")) {
				if(stream.accept("\n")) {
					this.cname = "p";
				}else{
					this.cname = "br";
				}
				this.close = true;
			}else{
				this.cname = "text";
				this.value = stream.accept_until(["[", ":", ">", "\n"]);
			}
		} catch (e) {
			// failed to parse an element, return it as text
			this.cname = "text";
			this.value = stream.from_mark();
		}
		this.name = this.cname.toLowerCase();
	}

	function tagList(stream) {
		var tags = [];
		while(!stream.empty()) {
			var next = new tag(stream);
			if(next.name == "text" && tags.length > 0 && tags[tags.length - 1].name == "text") {
				// concatenate consecutive text tags
				tags[tags.length - 1].value += next.value;
			}else{
				tags.push(next);
			}
		}
		return tags;
	}

	function urlParams(url) {
		var params = {};
		var pairs = url.split("?")[1].split("&");
		while(pairs.length) {
			var pair = pairs.shift().split("=");
			params[pair[0]] = pair[1];
		}
		return params;
	}

	// Translating multiple elements to "span" causes some incorrect behavior with reopening
	var tagElementNames = {
		"b": "B", 
		"i": "I",
		"u": "U",
		"s": "SPAN",
		"size": "SPAN",
		"color": "SPAN",
		"smcaps": "SPAN",
		"spoiler": "SPAN",
		"url": "A",
		"site_url": "A",
		"img": "IMG",
		"quote": "BLOCKQUOTE",
		"youtube": "DIV",
		"center": "DIV",
		"right": "DIV",
		"p": "P",
		"icon": "I",
		"email": "A",
		"code": "CODE",
		"indent": "DIV",
		"pre": "PRE",
		"codeblock": "PRE",
		"sub": "SUB",
		"sup": "SUP",
		"em": "EM",
		"strong": "STRONG",
		"list": ["UL", "OL"],
		"*": "LI"
	}
	function generateElements(tags) {
		var top = document.createElement("div");
		top.className = "bbcode";
		openNode(document.createElement("p"));
		function closeNode() {
			var lastTop = top;
			top = top.parentNode;
			// if the top element was empty, remove it.
			if(lastTop.childNodes.length == 0) {
				top.removeChild(lastTop);
			}
			// if the top block element ended with a br tag, remove that
			if(lastTop.lastChild && lastTop.lastChild.nodeName == "BR" && getComputedStyle(lastTop).display != "inline") {
				lastTop.removeChild(lastTop.lastChild);
			}
		}
		function tagNodeMatch(name, node) {
			return typeof(tagElementNames[name]) == "object" ? tagElementNames[name].indexOf(node.nodeName) != -1 : tagElementNames[name] == node.nodeName;
		}
		function closeTag(name) {
			if(!isTagOpen(name)) return [];
			var closedNodes = [];
			while(!tagNodeMatch(name, top)) {
				closedNodes.push(top.cloneNode(false));
				closeNode();
			}
			closeNode();
			return closedNodes;
		}
		function isTagOpen(name, before) {
			var open = top;
			while(!tagNodeMatch(name, open)) {
				if(before && tagNodeMatch(before, open)) {
					return false;
				}
				open = open.parentNode;
				if(open == null) {
					return false;
				}
			}
			return true;
		}
		function reopenNodes(nodes) {
			while(nodes.length > 0) {
				openNode(nodes.pop());
			}
			// we should always have a top level p element for text
			if(top.parentNode == null || top.nodeName == "BLOCKQUOTE") {
				openNode(document.createElement("p"));
			}
		}
		function openNode(node) {
			top.appendChild(node);
			top = top.lastChild;
		}
		function dumpTag(tag) {
			top.appendChild(document.createTextNode(
				(tag.name == "emote" ? ":" + tag.value + ":" :
					(tag.name == "quote_ref" ? ">>" + tag.value :
						("[" + (tag.close ? "/" : "") + tag.cname +
						(tag.value != undefined ? "=" + tag.value : "") + "]")
					)
				)
			));
		}
		for(var tag = tags.shift(); tag != undefined; tag = tags.shift()) {
			if(
				isTagOpen("pre") && !isTagOpen("code") &&
				(
					["hr", "codeblock", "right", "left", "indent", "youtube", "list"].indexOf(tag.name) != -1 ||
					(!tag.close && tag.name == "pre")
				)
			) {
				// prevent block-level elements from being opened inside a pre tag
				dumpTag(tag);
			}else if((tag.name == "code" || tag.name == "codeblock") && !tag.close && !isTagOpen("code")) {
				if(tag.name == "codeblock") {
					var closed = closeTag("p"); // these are reopened after the code block
					var element = document.createElement("pre");
					openNode(element);
				}
				var element = document.createElement("code");
				openNode(element);
			}else if((tag.name == "code" || (tag.name == "codeblock" && isTagOpen("pre"))) && tag.close == true && isTagOpen("code")) {
				closeNode(); // no bbcode tags should exist within a code block, so we assume it is the top element
				if(tag.name == "codeblock" && isTagOpen("pre")) {
					closeNode(); // similarly, a code block is a double element, so we assume it's parent is the pre
					openNode(document.createElement("p"));
					reopenNodes(closed); // elements that were saved before the code block are reopened here
				}
				reopenNodes(closed);
			}else if(isTagOpen("code")) {
				var element;
				if(tag.name == "text") {
					element = document.createTextNode(tag.value);
				}else if((tag.name == "p" || tag.name == "br") && tag.close == true) {
					element = document.createTextNode("\n" + (tag.name == "p" ? "\n" : ""));
				}else if(tag.name == "emote") {
					element = document.createElement("span");
					element.innerText = ":" + tag.value + ":";
					element.className = "code-emote";
				}else if(tag.name == "quote_ref") {
					element = document.createElement("span");
					element.innerText = ">>" + tag.value;
					element.className = "code-quote_ref";
				}else{
					if(tag.value === undefined) {
						element = document.createElement("span");
						element.innerText = "[" + (tag.close ? "/" : "") + tag.cname + "]";
						element.className = "code-tag";
					}else{
						element = document.createDocumentFragment();
						var part = document.createElement("span");
						part.innerText = "[" + tag.cname;
						part.className = "code-tag";
						element.appendChild(part);
						part = document.createElement("span");
						part.innerText = "=";
						part.className = "code-operator";
						element.appendChild(part);
						part = document.createElement("span");
						part.innerText = tag.value;
						part.className = "code-attr-value";
						element.appendChild(part);
						part = document.createElement("span");
						part.innerText = "]";
						part.className = "code-tag";
						element.appendChild(part);
					}
				}
				top.appendChild(element);
			}else if(tag.name == "text") {
				if(isTagOpen("pre") || !/^[ \t\r\n]*$/.test(tag.value)) {
					top.appendChild(document.createTextNode(tag.value));
				}
			}else if(tag.name == "img" && tag.close == false) {
				var image = document.createElement("img");
				if(tags.length >= 2 && tags[0].name == "text" && tags[1].name == "img" && tags[1].close == true) {
					image.src = tags.shift().value;
					tags.shift();
				}
				top.appendChild(image);
			}else if(tag.name == "email" && tag.close == false) {
				var link = document.createElement("a");
				if(tags.length >= 2 && tags[0].name == "text" && tags[1].name == "email" && tags[1].close == true) {
					var target = tags.shift().value;
					link.href = "mailto:" + target;
					link.appendChild(document.createTextNode(target));
					tags.shift();
				}
				top.appendChild(link);
			}else if(tag.name == "url" && tag.close == false && tag.value == undefined) {
				// the special case of the url with text equal to it's value
				var link = document.createElement("a");
				if(tags.length >= 2 && tags[0].name == "text" && tags[1].name == "url" && tags[1].close == true) {
					link.href = tags.shift().value;
					link.appendChild(document.createTextNode(link.href));
					tags.shift();
				}
				top.appendChild(link);
			}else if(tag.name == "icon" && tag.close == false) {
				var icon = document.createElement("i");
				if(tags.length >= 2 && tags[0].name == "text" && tags[1].name == "icon" && tags[1].close == true) {
					icon.classList.add("fa", "fa-fw", "fa-" + tags.shift().value);
					tags.shift();
				}
				top.appendChild(icon);
			}else if(tag.name == "hr" && tag.close == false) {
				// hr is a self-closing p-level tag
				var closed = closeTag("p");
				top.appendChild(document.createElement("hr"));
				openNode(document.createElement("p"));
				reopenNodes(closed);
			}else if(tag.name == "emote") {
				// emotes are really simple :)
				var emote = document.createElement("img");
				emote.src = emoteDict[tag.value];
				emote.alt = ":" + tag.value + ":";
				top.appendChild(emote);
			}else if(tag.name == "quote_ref") {
				var ref = document.createElement("a");
				ref.href = "#" + tag.value;
				ref.className = "quote_link";
				ref.appendChild(document.createTextNode(">>" + tag.value));
				top.appendChild(ref);
			}else if(tag.name == "youtube") {
				// the purpose of the container is to provide an alternate link if the embed doesn't work
				// currently it's not actually used for anything
				var closed = closeTag("p");
				var container = document.createElement("div");
				var player = document.createElement("iframe");
				player.src = "http://www.youtube.com/embed/" + urlParams(tag.value).v;
				container.appendChild(player);
				top.appendChild(container);
				openNode(document.createElement("p"));
				reopenNodes(closed);
			}else if(tag.name == "list" && !tag.close) {
				// is a block element, and does not contain a top level p
				var closed = closeTag("p");
				if(tag.value) {
					var elem = document.createElement("ol");
					elem.type = tag.value;
				}else{
					var elem = document.createElement("ul");
				}
				openNode(elem);
				reopenNodes(closed);
			}else if(tag.name == "*" && !tag.close && isTagOpen("list")) {
				var closed = isTagOpen("*", "list") ? closeTag("*") : [];
				openNode(document.createElement("li"));
				reopenNodes(closed);
			}else if(tag.close) {
				if(isTagOpen(tag.name)) {
					if(tag.name == "list") {
						var closed = closeTag("*").concat(closeTag("list"));
					}else{
						var closed = closeTag(tag.name);
					}
					if(tag.name == "pre") {
						// after leaving the pre tag, return to p at the root level
						openNode(document.createElement("p"));
					}
					reopenNodes(closed);
				}else if(tag.name != "p" && tag.name != "br") {
					// if this is an orphan closing tag, throw it in the text
					dumpTag(tag);
				}
				if(isTagOpen("pre")) {
					if(tag.name == "p" || tag.name == "br") {
						top.appendChild(document.createTextNode("\n" + (tag.name == "p" ? "\n" : "")));
					}
				}else if(tag.name == "br" && top.childNodes.length > 0) {
					top.appendChild(document.createElement("br"));
				}
			}else{ // open a new tag
				var element = document.createElement(tagElementNames[tag.name]);
				var closed = [];
				if(tag.name == "url") {
					element.href = tag.value;
				}else if(tag.name == "site_url") {
					element.href = localSite + tag.value;
				}else if(tag.name == "color") {
					element.style.color = tag.value;
				}else if(tag.name == "size") {
					// default size value is px, but can be supplied in em
					if(endsWith(tag.value, "em")) {
						element.style.fontSize = tag.value;
					}else{
						element.style.fontSize = tag.value + "px";
					}
				}else if(tag.name == "s") {
					element.style.textDecoration = "line-through";
				}else if(tag.name == "smcaps") {
					element.style.fontVariant = "small-caps";
				}else if(tag.name == "spoiler") {
					element.className = "spoiler";
				}else if(tag.name == "quote") {
					closed = closeTag("p");
					if(tag.value != undefined) element.setAttribute("data-who", tag.value);
				}else if(tag.name == "indent") {
					closed = closeTag("p");
					element.className = "indent-" + tag.value;
				}else if(tag.name == "center") {
					closed = closeTag("p");
					element.className = "center";
				}else if(tag.name == "right") {
					closed = closeTag("p");
					element.className = "right";
				}else if(tag.name == "pre") {
					closed = closeTag("p");
				}
				openNode(element);
				if(tag.name == "quote" || tag.name == "indent" || tag.name == "center" || tag.name == "right") {
					openNode(document.createElement("p"));
					reopenNodes(closed);
				}else if(tag.name == "pre") {
					// pre replaces the p element at the root level like the above tags, but doesn't contain p tags
					// so we don't open one
					reopenNodes(closed);
				}
			}
		}
		while(top.parentNode != null) {
			closeNode();
		}
		return top;
	}

	function endsWith(str, suffix) {
		return str.indexOf(suffix, str.length - suffix.length) !== -1;
	}

	this.render = function(str) {
		return generateElements(tagList(new stringStream(str)));
	}

	this.registerEmotes = function(emotes) {
		// expects an object of the form {"emotename": "emoteimagepath", ...}
		for(var key in emotes) {
			emoteDict[key] = emotes[key];
		}
	}

	// prefix for site_url tags, since this is generally used to generate off-site data
	var localSite = "";
	this.setLocalSite = function(site) {
		localSite = site;
	}
}
