var Downloads = ChromeUtils.import("resource://gre/modules/Downloads.jsm").Downloads;
var OS = ChromeUtils.import("resource://gre/modules/osfile.jsm").OS;

async function syncDirectories(files, dest, source, deleteFromSource, keepOld, log) {
	// moves all <files> to <dest>, from <source> if available, downloading from <file.url> if not
	// also, if <dest> is older than <file.modified>, redownload
	for(var file of files) {
		var list = await Downloads.getList(Downloads.ALL);
		async function queueDownload(source, target) {
			let download = await Downloads.createDownload({
				source: source,
				target: target
			});
			list.add(download);
			download.start();
		}
		var destPath = OS.Path.join(dest, file.name);
		var sourcePath = OS.Path.join(source, file.name);
		try {
			var destInfo = await OS.File.stat(destPath);
		} catch(e) {
			if(e instanceof OS.File.Error && e.becauseNoSuchFile) {
				var destInfo = null;
			}else{
				throw e;
			}
		}
		if(source) {
			try {
				var sourceInfo = await OS.File.stat(sourcePath);
			} catch(e) {
				if(e instanceof OS.File.Error && e.becauseNoSuchFile) {
					var sourceInfo = null;
				}else{
					throw e;
				}
			}
		}else{
			var sourceInfo = null;
		}
		//log({name: file.name, dest: destInfo != null, source: sourceInfo != null});
		if(sourceInfo == null && destInfo == null) {
			// we must download the file
			log("File '" + file.name + "' not present. Downloading.");
			await queueDownload(file.url, destPath);
		}else if(sourceInfo != null && destInfo == null) {
			// we must move the file
			log("File '" + file.name + "' in source. Moving.");
			await OS.File.move(sourcePath, destPath);
		}else if(sourceInfo != null && destInfo != null && deleteFromSource) {
			// source file is a duplicate, let's delete it
			log("Duplicate of '" + file.name + "' in source directory. Deleting.");
			await OS.File.remove(sourcePath);
		}
		if(destInfo != null && destInfo.lastModificationDate < file.modified) {
			// file is stale, redownload
			if(keepOld) {
				log("File '" + file.name + "' has been updated, and keepOld is set. Moving old file.");
				await OS.File.makeDir(OS.Path.join(dest, "old"), {ignoreExisting: true});
				var num = 2;
				var movePath = OS.Path.join(dest, "old", file.name);
				while(await OS.File.exists(movePath)) {
					var movePath = OS.Path.join(dest, "old", file.name + "." + num);
					num++;
				}
				await OS.File.move(destPath, movePath);
				log("Updated file '" + file.name + "' has been moved. Downloading.");
				await queueDownload(file.url, destPath);
			}else{
				log("File '" + file.name + "' has been updated. Downloading.");
				await queueDownload(file.url, destPath);
			}
		}
	}
	// we also look for unknown files in the destination directory
	function isInFileList(testFileName) {
		for(file of files) {
			if(testFileName == file.name)
				return true;
		}
		return false;
	}
	var dirIter = new OS.File.DirectoryIterator(dest);
	dirIter.forEach(
		function (dirEntry) {
			if(!dirEntry.isDir && !isInFileList(dirEntry.name)) {
				log("Unknown file in destination: " + dirEntry.name);
			}
		}
	).then(
		function () {
			dirIter.close();
			log("Sync Complete");
		},
		function (error) {
			dirIter.close();
			log(error);
		}
	);
}

var EXPORTED_SYMBOLS = ["syncDirectories"];