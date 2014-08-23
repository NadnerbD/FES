import json
import wget
import os

emoteList = json.load(open("characters.json", "r"))
for emote in emoteList:
	fileName = emote[1].rsplit("/", 1)[1]
	if not os.path.isfile(fileName):
		print "Downloading: %s" % fileName
		wget.download(emote[1])
