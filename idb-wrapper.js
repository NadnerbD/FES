// we like our console
if(typeof console == "undefined") var console = ChromeUtils.import("resource://gre/modules/Console.jsm").console;

// sometimes, if we're running from chrome, we won't have access to the indexedDB object
if(typeof indexedDB == "undefined") Components.utils.importGlobalProperties(["indexedDB"]);

// open/create database
function FFDB(name, callback, aid) {
	var db; // private database connection
	
	function openDB(name, callback, aid) {
		if(aid) {
			// access an arbitrary domain context!
			var principal = Components.classes["@mozilla.org/scriptsecuritymanager;1"].getService(Components.interfaces.nsIScriptSecurityManager).createContentPrincipalFromOrigin(aid);
			var req = indexedDB.openForPrincipal(principal, name, 2);
		}else{
			var req = indexedDB.open(name, 2);
		}
		req.onupgradeneeded = function(event) {
			var db = req.result;
			if(event.oldVersion < 1) {
				var commentStore = db.createObjectStore("comments", {keyPath: "id"});
				commentStore.createIndex("location", "location", {unique: false});
				var storyStore = db.createObjectStore("stories", {keyPath: "id"});
				var userStore = db.createObjectStore("users", {keyPath: "name"});
				console.log("initialized fimfiction-comments-db with name: " + db.name);
			}
			if(event.oldVersion < 2) {
				var shelfStore = db.createObjectStore("bookshelves", {keyPath: "id"});
				console.log("upgraded (to version 2) fimfiction-comments-db with name: " + db.name);
			}
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
			};}(i);
		}
	}
	
	// merges items with their counterparts in the database, updating only values that are present in the new item
	this.updateItems = function(storeName, data, callback) {
		var results = 0;
		function countResults(event) {
			results++;
			if(!(results < data.length)) {
				callback();
			}
		}
		var itemCount = 0;
		// don't try to modify the same item multiple times within the same transaction, only one will take
		// if doing so is necessary (why?) move the transaction line into the loop to create separate transactions for each item
		var store = db.transaction(storeName, "readwrite").objectStore(storeName);
		for(var newItem of data) {
			var req = store.get(newItem[store.keyPath]);
			// the idb api allows us to perform the get and put within the same transaction
			req.onsuccess = function(newItem, req, store) { return function(event) {
				var subreq;
				if(req.result) {
					// if the item exists, merge in the values from newItem
					function recursiveMerge(source, dest) {
						for(var key in source) {
							if(Object.prototype.toString.call(source[key]) == "[object Object]"
							&& Object.prototype.toString.call(dest[key]) == "[object Object]") {
								recursiveMerge(source[key], dest[key]);
							}else{
								dest[key] = source[key];
							}
						}
					}
					recursiveMerge(newItem, req.result);
					subreq = store.put(req.result);
				}else{
					// if not, just add newItem to the database
					subreq = store.put(newItem);
				}
				subreq.onsuccess = countResults;
				subreq.onerror = function(event) {
					console.log("error merging '" + JSON.stringify(newItem) + "' into '" + storeName + "'");
					countResults(event);
				}
			};}(newItem, req, store);
			req.onerror = function(newItem) { return function(event) {
				console.log("error fetching '" + JSON.stringify(newItem) + "' from '" + storeName + "' for merging");
				countResults(event);
			};}(newItem);
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
	
	// delete specific value
	this.deleteItem = function(storeName, index, callback) {
		var store = db.transaction(storeName, "readwrite").objectStore(storeName);
		var req = store.delete(index);
		req.onsuccess = function(event) {
			callback();
		};
		req.onerror = function(event) {
			console.log("error deleting value for '" + index + "' from '" + storeName + "'");
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
	
	// get the keys of items whose indexName value matches index (doesn't fetch the entire database item)
	this.getKeysByIndex = function(storeName, indexName, index, callback) {
		var data = new Array();
		var storeIndex = db.transaction(storeName).objectStore(storeName).index(indexName);
		var req = storeIndex.openKeyCursor(IDBKeyRange.only(index));
		req.onsuccess = function(event) {
			var cursor = req.result;
			if(cursor) {
				data.push(cursor.primaryKey);
				cursor.continue();
			}else{
				callback(data);
			}
		};
		req.onerror = function(event) {
			console.log("error finding element keys from '" + storeName + "' with '" + indexName + "' values matching '" + index + "'");
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

/*
function testCommentDatabase() {
	var runner = function() {
		var db, result;
		yield db = new FFDB("testdb", cb);
		yield db.putItems("comments", [
			{id: "123", location: "story1"},
			{id: "124", location: "story2"},
			{id: "125", location: "story1"}
		], cb);
		console.log("putitems successful");
		yield db.updateItems("comments", [
			{id: "123", author: "Nadnerb"},
			{id: "125", date: new Date()}
		], cb);
		console.log("updated 2 items");
		result = yield db.getItemsByIndex("comments", "location", "story1", cb);
		console.log("got items with location story1");
		for(var i in result) {
			console.log(JSON.stringify(result[i]));
		}
		result = yield db.getKeysByIndex("comments", "location", "story2", cb);
		console.log("got keys of items with location story2");
		for(var key of result) {
			console.log(key);
		}
		db.close();
		indexedDB.deleteDatabase("testdb");
		console.log("cleaned up test database");
	}();
	function cb(result) { 
		try { 
			runner.send(result);
		}catch(e) {
			console.log("running complete");
		}
	}
	runner.next();
	
	var db = new FFDB("testdb", function() {
		db.putItems("comments", [
			{id: "123", location: "story1"},
			{id: "124", location: "story2"},
			{id: "125", location: "story1"}
		], function() {
			console.log("putitems successful");
			db.updateItems("comments", [
				{id: "123", author: "Nadnerb"},
				{id: "125", date: new Date()}
			], function() {
				console.log("updated 2 items");
				db.getItemsByIndex("comments", "location", "story1", function(items) {
					console.log("got items with location story1");
					for(var i in items) {
						console.log(JSON.stringify(items[i]));
					}
					db.getKeysByIndex("comments", "location", "story2", function(keys) {
						console.log("got keys of items with location story2");
						for(var key of keys) {
							console.log(key);
						}
						db.close();
						indexedDB.deleteDatabase("testdb");
						console.log("cleaned up test database");
					});
				});
			});
		});
	});
}
*/

var EXPORTED_SYMBOLS = ["FFDB"];