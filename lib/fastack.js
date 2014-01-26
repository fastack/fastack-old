var   fs = require('fs')
	, celeri = require('celeri')
	;

/*
	Walk a directory asynchronously and recurse into subfolders. Helper function. Calls back with array of file paths.

	* 'dir' |String| path to directory you want to recurse through
	* 'done' |Function| is called with (error, array of file paths)
*/
function recurse(dir, done) {
	var results = [];
	fs.readdir(dir, function(err, list) {
		if (err) return done(err);
		var pending = list.length;
		if (!pending) return done(null, results);
		list.forEach(function(file) {
			file = dir + '/' + file;
			fs.stat(file, function(err, stat) {
				if (stat && stat.isDirectory()) {
					recurse(file, function(err, res) {
						results = results.concat(res);
						if (!--pending) done(null, results);
					})
				}
				else {
					results.push(file);
					if (!--pending) done(null, results);
				}
			})
		})
	})
}

/* 
	Recurse through a directory and compress it into one file for upload

	* 'directory' |String| is the directory to be compressed
	* 'callback' |Function| is called with (error, path of compressed file)
*/
function packageApp(directory, callback) {
	var   archiver = require('archiver')
		, zlib = require('zlib')
		, gzipper = zlib.createGzip()
		, target = directory + '/fastack-deploy-package.tar.gz'
		, output = fs.createWriteStream(target)
		, archive = archiver('tar')
		;

	archive.on('error', function(err) {
	  throw err;
	});

	archive.pipe(gzipper).pipe(output);

	recurse(directory, function(err, files) {
		if (err) throw err;
		var spinner = celeri.loading('Located ' + files.length + ' files.').done();

		files.forEach(function(file, index) {
			archive.append(fs.createReadStream(file), { name: file });
			var i = index + 1;
			celeri.progress('Compressing: ', (i/files.length)*100);
		})
		archive.finalize(function(err, bytes) {
		  if (err) throw err;
		  var info = {
		  	files: files,
		  	arhiveSize: bytes
		  };
		  callback(null, info, target);
		});
	})
}


// Deploying to Fastack
celeri.option({
	command: 'deploy OR deploy :directory',
	description: 'Deploys "[directory] to fastack"'
}, function(data) {
	var dir = (data.directory) ? './' + data.directory : './';
	if (fs.existsSync(dir)) {
		packageApp(dir, function(err, info, compressed) {
			console.log(compressed);
		})
	} 
	else {
		console.error('Directory ' +dir.substring(2)+ ' does not exist!')
	}

});

//parse the command line args
celeri.parse(process.argv);