import json
import urllib2
import os

hdr = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.11 (KHTML, like Gecko) Chrome/23.0.1271.64 Safari/537.11',
       'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
       'Accept-Charset': 'ISO-8859-1,utf-8;q=0.7,*;q=0.3',
       'Accept-Encoding': 'none',
       'Accept-Language': 'en-US,en;q=0.8',
       'Connection': 'keep-alive'}

emoteList = json.load(open("characters.json", "r"))
for emote in emoteList:
	fileName = urllib2.unquote(emote[1].rsplit("/", 1)[1])
	if not os.path.isfile(fileName):
		print "Downloading: %s" % fileName
		req = urllib2.Request(emote[1], headers=hdr)
		fp = urllib2.urlopen(req)
		op = open(fileName, 'wb')
		op.write(fp.read())
		op.close()
