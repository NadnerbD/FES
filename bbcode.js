function bbcode() {
	/*
		Simple parser designed to transform BBCode into a DOM tree
		
		steps:
			lexing:
				scan for tags, generate tag stream
			parsing/generation:
				generate DOM tree from tag stream
		
		lexing grammar:
			name = "b" | "i" | "u" | "s" | "size" | "color" | "url" | "img" | "quote" | "youtube";
			tag = "[" ("/" name) | (name [ "=" value ]) "]";
			emote = ":" emote_name ":";
			quote_ref = ">>" number;
			close_p = "\n";
		
		we place invalid tags back into the stream as text
		extracting emotes poses a slight problem. where should they be extracted from?
		second pass on text nodes seems like the best place.
		
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
		this.accept = function(token) {
			if(next == token) {
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

	function tagName(stream) {
		// this is some crazy hax. I wouldn't do this in a parser that could actually
		// complain about invalid input
		var tagNames = ["b", "i", "u", "s", "size", "color", "url", "img", "quote", "youtube"];
		var index = 0;
		while(true) {
			var nextNames = [];
			// check all names to see if they can be advanced
			for(var tagName = 0; tagName < tagNames.length; tagName++) {
				if(stream.peek() == tagNames[tagName][index] || index == tagNames[tagName].length) {
					nextNames.push(tagNames[tagName]);
				}
			}
			// advance the stream
			for(var i = 0; i < nextNames.length; i++) {
				if(stream.accept(nextNames[i][index])) {
					break;
				}
			}
			if(nextNames.length == 1 && nextNames[0].length == index) {
				// if we've hit the end of a valid name, and it's the only one remaining..
				return nextNames[0];
			}else if(nextNames.length == 0) {
				// or if we've eliminated all name candidtates
				throw "Invalid tagName";
			}
			tagNames = nextNames;
			index++;
		}
	}

	function emoteName(stream) {
		// we don't have a list of these yet...
		throw "Invalid emoteName";
	}

	function integerString(stream) {
		var nums = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
		var str = "";
		while(stream.peek() in nums) {
			str += stream.read();
		}
		if(str.length == 0) {
			throw "Invalid number";
		}
		return parseInt(str);
	}

	function tag(stream) {
		stream.mark();
		try {
			this.close = false;
			if(stream.accept("[")) {
				if(stream.accept("/")) {
					this.close = true;
					this.name = tagName(stream);
				}else{
					this.name = tagName(stream);
					if(stream.accept("=")) {
						this.value = stream.accept_until(["]"]);
					}
				}
				stream.expect("]");
			}else if(stream.accept(":")) {
				this.name = "emote";
				this.value = emoteName(stream);
				stream.expect(":");
			}else if(stream.accept(">")) {
				stream.expect(">");
				this.name = "quote_ref";
				this.value = integerString(stream);
			}else if(stream.accept("\n")) {
				if(stream.accept("\n")) {
					this.value = "double";
				}
				this.close = true;
				this.name = "p";
			}else{
				this.name = "text";
				this.value = stream.accept_until(["[", ":", ">", "\n"]);
			}
		} catch (e) {
			// failed to parse an element, return it as text
			this.name = "text";
			this.value = stream.from_mark();
		}
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
		"url": "A",
		"img": "IMG",
		"quote": "BLOCKQUOTE",
		"youtube": "DIV",
		"p": "P"
	}
	function generateElements(tags) {
		var top = document.createElement("div");
		openNode(document.createElement("p"));
		function closeNode() {
			var lastTop = top;
			top = top.parentNode;			
			// if the top element was empty, remove it.
			if(lastTop.childNodes.length == 0) {
				top.removeChild(lastTop);
			}
		}
		function closeTag(name) {
			var closedNodes = [];
			while(tagElementNames[name] != top.nodeName) {
				closedNodes.push(top.cloneNode(false));
				closeNode();
			}
			closeNode();
			return closedNodes;
		}
		function isTagOpen(name) {
			var open = top;
			while(open.nodeName != tagElementNames[name]) {
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
		for(var tag = tags.shift(); tag != undefined; tag = tags.shift()) {
			if(tag.name == "text") {
				top.appendChild(document.createTextNode(tag.value));
			}else if(tag.name == "img") {
				var image = document.createElement("img");
				if(tags.length >= 2 && tags[0].name == "text" && tags[1].name == "img") {
					image.src = tags.shift().value;
					tags.shift();
				}
				top.appendChild(image);
			}else if(tag.name == "emote") {
				// emotes are really simple :)
				var emote = document.createElement("img");
				emote.src = "emotes/" + tag.value + ".jpg";
				top.appendChild(emote);
			}else if(tag.name == "quote_ref") {
				var ref = document.createElement("a");
				ref.href = "#" + tag.value;
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
			}else if(tag.close) {
				if(isTagOpen(tag.name)) {
					reopenNodes(closeTag(tag.name));
				}
				if(tag.name == "p" && tag.value == "double") {
					top.className = "double";
				}
			}else{ // open a new tag
				var element = document.createElement(tagElementNames[tag.name]);
				var closed = [];
				if(tag.name == "url") {
					element.href = tag.value;
				}else if(tag.name == "color") {
					element.style.color = tag.value;
				}else if(tag.name == "size") {
					element.style.fontSize = tag.value + "px";
				}else if(tag.name == "s") {
					element.style.textDecoration = "line-through";
				}else if(tag.name == "quote") {
					closed = closeTag("p");
				}
				openNode(element);
				if(tag.name == "quote") {
					openNode(document.createElement("p"));
					reopenNodes(closed);
				}
			}
		}
		while(top.parentNode != null) {
			closeNode();
		}
		return top;
	}

	this.render = function(str) {
		return generateElements(tagList(new stringStream(str)));
	}
}
