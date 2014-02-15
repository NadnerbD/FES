var charlist = []
var chars = document.querySelectorAll("div.characters_dropdown img");
for(i = 0; i < chars.length; i++) {
	charlist.push([chars[i].parentNode.title, chars[i].src]);
}
JSON.stringify(charlist);