// No bullshit, just what's necessary to actually make shit work
var console = Components.utils.import("resource://gre/modules/Console.jsm", {}).console;
var ioServ = Components.classes["@mozilla.org/network/io-service;1"].createInstance(Components.interfaces.nsIIOService);
var resHandler = ioServ.getProtocolHandler("resource").QueryInterface(Components.interfaces.nsIResProtocolHandler);
var winMed = Components.classes['@mozilla.org/appshell/window-mediator;1'].getService(Components.interfaces.nsIWindowMediator);
var globalMM = Components.classes["@mozilla.org/globalmessagemanager;1"].getService(Components.interfaces.nsIMessageListenerManager);
var clipboardHelper = Components.classes["@mozilla.org/widget/clipboardhelper;1"].getService(Components.interfaces.nsIClipboardHelper);
Components.utils.import("resource://gre/modules/osfile.jsm");
Components.utils.importGlobalProperties(["TextEncoder", "TextDecoder"]);
Components.utils.import("resource://gre/modules/Extension.jsm");

function install(data, reason) {}

function uninstall(data, reason) {}

const uid = Date.now();

var web_ext;

function startup(data, reason) {
	console.log("FES Revision 5 Starting (" + uid + ")");
	// first up, set up a resource alias for our local files
	var alias = ioServ.newFileURI(data.installPath);
	if(!data.installPath.isDirectory()) {
		alias = ioServ.newURI("jar:" + alias.spec + "!/", null, null);
	}
	resHandler.setSubstitution("fimfic-res", alias);
	// create a fake WebExtension so that we can use web_accessible_resources
	web_ext = new Extension({id: data.id, version: data.version, resourceURI: alias});
	console.log("Starting WebExtension " + data.id + " " + data.version + " " + web_ext.uuid);
	web_ext.startup();
	// then import a module from our namespace
	Components.utils.import("resource://fimfic-res/sync-download.js");
	// listen for frame scripts starting up
	globalMM.addMessageListener("FimfictionEnhancementSuite@nadnerb.net:uid-request", uidProvider);
	// listen for messages requesting actions that must be performed in the chrome script
	globalMM.addMessageListener("FimfictionEnhancementSuite@nadnerb.net:chrome-request", chromeRequestListener);
	// set up a delayed load frame script for all content processes (after we start listening for uid requests)
	globalMM.loadFrameScript("resource://fimfic-res/frame-script.js?" + uid, true);
}

function shutdown(data, reason) {
	if(reason == APP_SHUTDOWN) return;
	console.log("FES Shutting down (" + uid + ")");
	// kill our fake WebExtension
	web_ext.shutdown();
	// stop loading our frame script into new tabs
	globalMM.removeDelayedFrameScript("resource://fimfic-res/frame-script.js?" + uid);
	// send a message to frame scripts to stop watching for pageloads
	globalMM.broadcastAsyncMessage("FimfictionEnhancementSuite@nadnerb.net:shutdown", {uid: uid});
	// stop listening for frame scripts starting up
	globalMM.removeMessageListener("FimfictionEnhancementSuite@nadnerb.net:uid-request", uidProvider);
	// stop listening for messages from frame scripts
	globalMM.removeMessageListener("FimfictionEnhancementSuite@nadnerb.net:chrome-request", chromeRequestListener);
	// unload our module
	Components.utils.unload("resource://fimfic-res/sync-download.js");
	// unregister our resource handler
	resHandler.setSubstitution("fimfic-res", null);
}

function uidProvider(message) {
	message.target.messageManager.sendAsyncMessage("FimfictionEnhancementSuite@nadnerb.net:uid", {
		uid: uid,
		uuid: web_ext.uuid
	});
}

function chromeRequestListener(message) {
	//console.log("DEBUG: chrome request", message.data);
	switch(message.data.request) {
		case "CopyString":
			clipboardHelper.copyString(message.data.string);
		break;
		case "AddTab":
			var win = winMed.getMostRecentWindow("navigator:browser");
			win.gBrowser.selectedTab = win.gBrowser.addTab(message.data.url);
		break;
		case "PickFolder":
			var filePicker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
			filePicker.init(message.target.ownerDocument.defaultView, message.data.title, filePicker.modeGetFolder);
			filePicker.open(function() {
				message.target.messageManager.sendAsyncMessage("FimfictionEnhancementSuite@nadnerb.net:chrome-response", {
					origin: message.data.origin,
					request: "PickedFolder",
					title: message.data.title,
					// file can be null if the user didn't actually pick a file
					folder: filePicker.file ? filePicker.file.path : null
				});
			});
		break;
		case "PickFile":
			var filePicker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
			filePicker.init(message.target.ownerDocument.defaultView, message.data.title, [filePicker.modeOpen, filePicker.modeSave][message.data.saveFile]);
			filePicker.appendFilters(filePicker.filterAll);
			if(message.data.fileType) {
				filePicker.appendFilter(message.data.fileType.title, message.data.fileType.filter);
			}
			filePicker.open(function() {
				message.target.messageManager.sendAsyncMessage("FimfictionEnhancementSuite@nadnerb.net:chrome-response", {
					origin: message.data.origin,
					request: "PickedFile",
					title: message.data.title,
					// file can be null if the user didn't actually pick a file
					filePath: filePicker.file ? filePicker.file.path : null
				});
			});
		break;
		case "WriteFile":
			var encoder = new TextEncoder();
			var dataArray = encoder.encode(message.data.data);
			OS.File.writeAtomic(message.data.name, dataArray, {tmpPath: message.data.name + ".tmp"}).then(
				function () {
					message.target.messageManager.sendAsyncMessage("FimfictionEnhancementSuite@nadnerb.net:chrome-response", {
						origin: message.data.origin,
						request: "FileWritten",
						name: message.data.name
					});
				}
			);
		break;
		case "ReadFile":
			OS.File.read(message.data.name).then(
				function (dataArray) {
					var decoder = new TextDecoder();
					message.target.messageManager.sendAsyncMessage("FimfictionEnhancementSuite@nadnerb.net:chrome-response", {
						origin: message.data.origin,
						request: "FileRead",
						name: message.data.name,
						data: decoder.decode(dataArray)
					});
				}
			);
		break;
		case "SyncFolders":
			syncDirectories(message.data.files, message.data.dest, message.data.source, message.data.deleteFromSource, message.data.keepOld, function(logStr) {
				message.target.messageManager.sendAsyncMessage("FimfictionEnhancementSuite@nadnerb.net:chrome-response", {
					origin: message.data.origin,
					request: "SyncStatusLog",
					msg: logStr
				});
			});
		default:
			// do nothing
		break;
	}
}