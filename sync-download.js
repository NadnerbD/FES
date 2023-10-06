var Downloads = ChromeUtils.import("resource://gre/modules/Downloads.jsm").Downloads;
Components.utils.importGlobalProperties(["IOUtils"]);

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
		var destPath = PathUtils.join(dest, file.name);
		var sourcePath = PathUtils.join(source, file.name);
		try {
			var destInfo = await IOUtils.stat(destPath);
		} catch(e) {
			if(e instanceof DOMException && e.name == "NotFoundError") {
				var destInfo = null;
			}else{
				throw e;
			}
		}
		if(source) {
			try {
				var sourceInfo = await IOUtils.stat(sourcePath);
			} catch(e) {
				if(e instanceof DOMException && e.name == "NotFoundError") {
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
			await IOUtils.move(sourcePath, destPath);
		}else if(sourceInfo != null && destInfo != null && deleteFromSource) {
			// source file is a duplicate, let's delete it
			log("Duplicate of '" + file.name + "' in source directory. Deleting.");
			await IOUtils.remove(sourcePath);
		}
		if(destInfo != null && new Date(destInfo.lastModified) < file.modified) {
			// file is stale, redownload
			if(keepOld) {
				log("File '" + file.name + "' has been updated, and keepOld is set. Moving old file.");
				await IOUtils.makeDirectory(PathUtils.join(dest, "old"), {ignoreExisting: true});
				var num = 2;
				var movePath = PathUtils.join(dest, "old", file.name);
				while(await IOUtils.exists(movePath)) {
					var movePath = PathUtils.join(dest, "old", file.name + "." + num);
					num++;
				}
				await IOUtils.move(destPath, movePath);
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
	for(const path of await IOUtils.getChildren(dest)) {
		var { type } = await IOUtils.stat(path);
		var filename = PathUtils.filename(path);
		if(type != "directory" && !isInFileList(filename)) {
			log("Unknown file in destination: " + filename);
		}
	}
	log("Sync Complete");
}

var EXPORTED_SYMBOLS = ["syncDirectories"];