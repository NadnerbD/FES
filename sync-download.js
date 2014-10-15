Components.utils.import("resource://gre/modules/Downloads.jsm");
Components.utils.import("resource://gre/modules/Task.jsm");

function queueDownload(source, target) {
	Task.spawn(function () {
		let list = yield Downloads.getList(Downloads.ALL);
		let download = yield Downloads.createDownload({
			source: source,
			target: target
		});
		list.add(download);
		download.start();
	}).then(null, Components.utils.reportError);
}

/* Example usage */
/* queueDownload("https://mdn.mozillademos.org/files/6265/debug.png", "C:\\Users\\Default\\Desktop\\example-download.png"); */

/* Now for the synchronization */

Components.utils.import("resource://gre/modules/osfile.jsm");

function syncDirectories(files, dest, source, deleteFromSource, keepOld, log) {
	// moves all <files> to <dest>, from <source> if available, downloading from <file.url> if not
	// also, if <dest> is older than <file.modified>, redownload
	Task.spawn(function () {
		for(var file of files) {
			var destPath = OS.Path.join(dest, file.name);
			var sourcePath = OS.Path.join(source, file.name);
			try {
				var destInfo = yield OS.File.stat(destPath);
			} catch(e if e instanceof OS.File.Error && e.becauseNoSuchFile) {
				var destInfo = null;
			}
			if(source) {
				try {
					var sourceInfo = yield OS.File.stat(sourcePath);
				} catch(e if e instanceof OS.File.Error && e.becauseNoSuchFile) {
					var sourceInfo = null;
				}
			}else{
				var sourceInfo = null;
			}
			//log({name: file.name, dest: destInfo != null, source: sourceInfo != null});
			if(sourceInfo == null && destInfo == null) {
				// we must download the file
				log("File '" + file.name + "' not present. Downloading.");
				queueDownload(file.url, destPath);
			}else if(sourceInfo != null && destInfo == null) {
				// we must move the file
				log("File '" + file.name + "' in source. Moving.");
				OS.File.move(sourcePath, destPath).then(null, Components.utils.reportError);
			}else if(sourceInfo != null && destInfo != null && deleteFromSource) {
				// source file is a duplicate, let's delete it
				log("Duplicate of '" + file.name + "' in source directory. Deleting.");
				OS.File.remove(sourcePath).then(null, Components.utils.reportError);
			}
			if(destInfo != null && destInfo.lastModificationDate < file.modified) {
				// file is stale, redownload
				if(keepOld) {
					log("File '" + file.name + "' has been updated, and keepOld is set. Moving old file.");
					Task.spawn(function() {
						yield OS.File.makeDir(OS.Path.join(dest, "old"), {ignoreExisting: true});
						var num = 2;
						var movePath = OS.Path.join(dest, "old", file.name);
						while(yield OS.File.exists(movePath)) {
							var movePath = OS.Path.join(dest, "old", file.name + "." + num);
							num++;
						}
						yield OS.File.move(destPath, movePath);
						log("Updated file '" + file.name + "' has been moved. Downloading.");
						queueDownload(file.url, destPath);
					}).then(null, Components.utils.reportError);
				}else{
					log("File '" + file.name + "' has been updated. Downloading.");
					queueDownload(file.url, destPath);
				}
			}
		}
		log("Sync Complete");
	}).then(null, Components.utils.reportError);
}

var EXPORTED_SYMBOLS = ["syncDirectories"];