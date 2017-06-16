import json
import struct
import urllib

def get_image_info(data):
	if is_png(data):
		w, h = struct.unpack('>LL', data[16:24])
		width = int(w)
		height = int(h)
	else:
		raise Exception('not a png image')
	return width, height

def is_png(data):
	return (data[:8] == '\211PNG\r\n\032\n' and (data[12:16] == 'IHDR'))

d = json.load(open("characters.json", "r"))
o = open("characters.css", "w")

header = """
/* replace character tags with images */
.story-tags > li a.tag-character, a.tag-character {
	border: none !important;
	padding: 0;
	width: calc(1.6em + 2px);
	line-height: calc(1.6em + 2px);
	white-space: nowrap;
	color: transparent;
	background-size: contain;
	/* for story card elements */
	display: inline-block;
	text-decoration: none;
	border-radius: 0.3em;
}
.story-card .story-card__tags li:not([style])::before,
.front_page .featured_box .right .featured_story .featured-story__tags li:not([style])::before {
	content: none;
}
.story-card .story-card__tags li:not([style]):not(first-of-type),
.front_page .featured_box .right .featured_story .featured-story__tags li:not([style]):not(first-of-type) {
	margin-left: .1875rem;
}
"""
ruleTemplate = """
a.tag-character[title="%s"] {
	background-image: url(resource://fimfic-res/characters/%s);%s
}
"""
o.write(header)
for c in d:
	iname = c[1].rsplit("/", 1)[1]
	with open(urllib.unquote(iname), "rb") as ifile:
		idata = ifile.read(24)
	if is_png(idata):
		width, height = get_image_info(idata)
	o.write(ruleTemplate % (c[0], iname, "\n\twidth: calc((1.6em + 2px) * %r);" % (width / 32.0) if width != 32 else ""))
o.close()