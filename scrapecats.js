var catlist = []
var cats = document.querySelectorAll("ul.tags-dropdown li");
for(i = 0; i < cats.length; i++) {
	if(cats[i].getAttribute("data-tag").startsWith("g:") || cats[i].getAttribute("data-tag").startsWith("t:")) {
		var cat_name = cats[i].getAttribute("data-name");
		var cat_id = cats[i].getAttribute("data-tag").split(":")[1];
		var elem = document.createElement("a");
		elem.className = "story_category_" + cat_id;
		var style = getComputedStyle(elem);
		catlist.push([
			cat_name,
			cat_id,
			style["background-color"],
			style["border-top-color"]
		]);
	}
}
var styles = "";
var table_out = "\t\t{\n";
for(var cat of catlist) {
	styles += "\t\ta." + cat[1] + " { background-image: linear-gradient(to bottom, " + cat[2] + " 0%, " + cat[3] + " 100%); }\n";
	table_out += '\t\t\t"' + cat[0] + '": {tag: "a", attrs: {title: "' + cat[0] + '", className: "' + "category " + cat[1] + '"}, children: ["' + cat[0].substring(0, 2) + '"]}' + ",\n";
}
table_out += "\t\t}";
console.log(styles);
console.log(table_out);