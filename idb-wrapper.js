// we like our console
if(!console) var console = Components.utils.import("resource://gre/modules/devtools/Console.jsm", {}).console;

// open/create database
function FFDB(name, callback, aid) {
	var db; // private database connection
	
	function openDB(name, callback, aid) {
		if(aid) {
			// access an arbitrary domain context!
			var puri = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService).newURI(aid, null, null);
			var principal = Components.classes["@mozilla.org/scriptsecuritymanager;1"].getService(Components.interfaces.nsIScriptSecurityManager).getCodebasePrincipal(puri);
			var req = indexedDB.openForPrincipal(principal, name);
		}else{
			var req = indexedDB.open(name);
		}
		req.onupgradeneeded = function(event) {
			var db = req.result;
			var commentStore = db.createObjectStore("comments", {keyPath: "id"});
			commentStore.createIndex("location", "location", {unique: false});
			var storyStore = db.createObjectStore("stories", {keyPath: "id"});
			var userStore = db.createObjectStore("users", {keyPath: "name"});
			console.log("initialized fimfiction-comments-db with name: " + db.name);
		};
		req.onsuccess = function(event) {
			db = req.result;
			callback();
		};
		req.onerror = function(event) {
			console.log("Error opening database: '" + name + "'");
		};
	}
	
	// put an element in the database
	this.putItem = function(storeName, data, callback) {
		var store = db.transaction(storeName, "readwrite").objectStore(storeName);
		var req = store.put(data);
		req.onsuccess = function(event) {
			callback();
		};
		req.onerror = function(event) {
			console.log("error putting '" + JSON.stringify(data) + "' into '" + storeName + "'");
		};
	}
	
	// put multiple items in the database
	this.putItems = function(storeName, data, callback) {
		var results = 0;
		function countResults(event) {
			results++;
			if(!(results < data.length)) {
				callback();
			}
		}
		var store = db.transaction(storeName, "readwrite").objectStore(storeName);
		for(var i = 0; i < data.length; i++) {
			var req = store.put(data[i]);
			req.onsuccess = countResults;
			req.onerror = function (i) { return function(event) {
				console.log("error putting '" + JSON.stringify(data[i]) + "' into '" + storeName + "'");
				countResults(event);
			} }(i);
		}
	}
	
	// get specific value
	this.getItem = function(storeName, index, callback) {
		var store = db.transaction(storeName).objectStore(storeName);
		var req = store.get(index);
		req.onsuccess = function(event) {
			if(req.result) {
				callback(req.result);
			}else{
				callback(null);
			}
		};
		req.onerror = function(event) {
			console.log("error getting value for '" + index + "' from '" + storeName + "'");
		};
	}
	
	// get items whose indexName value matches index
	this.getItemsByIndex = function(storeName, indexName, index, callback) {
		var data = new Array();
		var storeIndex = db.transaction(storeName).objectStore(storeName).index(indexName);
		var req = storeIndex.openCursor(IDBKeyRange.only(index));
		req.onsuccess = function(event) {
			var cursor = req.result;
			if(cursor) {
				data.push(cursor.value);
				cursor.continue();
			}else{
				callback(data);
			}
		};
		req.onerror = function(event) {
			console.log("error finding elements from '" + storeName + "' with '" + indexName + "' values matching '" + index + "'");
		};
	}
	
	// get everything
	this.getAllOrdered = function(storeName, orderIndex, callback) {
		var data = new Array();
		var storeIndex = db.transaction(storeName).objectStore(storeName).index(orderIndex);
		var req = storeIndex.openCursor();
		req.onsuccess = function(event) {
			var cursor = req.result;
			if(cursor) {
				data.push(cursor.value);
				cursor.continue(); // will fire this callback again
			}else{
				callback(data);
			}
		};
		req.onerror = function(event) {
			console.log("error getting all data from '" + storeName + "' ordered by '" + orderIndex + "'");
		};
	}
	
	// get everything
	this.getAll = function(storeName, callback) {
		var data = new Array();
		var store = db.transaction(storeName).objectStore(storeName);
		var req = store.openCursor();
		req.onsuccess = function(event) {
			var cursor = req.result;
			if(cursor) {
				data.push(cursor.value);
				cursor.continue(); // will fire this callback again
			}else{
				callback(data);
			}
		};
		req.onerror = function(event) {
			console.log("error getting all data from '" + storeName + "'");
		};
	}
	
	// close the database connection
	this.close = function() {
		db.close();
	}
	
	// initialize the db
	openDB(name, callback, aid);
}

function testCommentDatabase() {
	var db = new FFDB("testdb", function() {
		db.putItems("comments", [
			{id: "123", location: "story1"},
			{id: "124", location: "story2"},
			{id: "125", location: "story1"}
		], function() {
			console.log("putitems successful");
			db.getItemsByIndex("comments", "location", "story1", function(items) {
				console.log("got items with location story1");
				for(var i in items) {
					console.log(JSON.stringify(items[i]));
				}
				db.close();
				indexedDB.deleteDatabase("testdb");
				console.log("cleaned up test database");
			});
		});
	});
}

var EXPORTED_SYMBOLS = ["FFDB"];