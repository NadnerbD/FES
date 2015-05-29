var charlist = []
var chars = document.querySelectorAll("ul.tags-dropdown img");
for(i = 0; i < chars.length; i++) {
	charlist.push([chars[i].parentNode.parentNode.getAttribute("data-name"), chars[i].src]);
}
JSON.stringify(charlist);