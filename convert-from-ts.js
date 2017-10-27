var shell = require('shelljs');
var fs = require("fs");
var path = require("path");
var ts = require("typescript");

var config = JSON.parse(fs.readFileSync('ts2fable-config.json').toString())

var convertedFiles = []

function addWithImports(file, imports, visited) {
    var filePath = file.filename;
    if ((visited.indexOf(filePath) >= 0)) return;
    visited.push(filePath);
    if (imports.find(f => f.filename == filePath)) return;
    var code = fs.readFileSync(filePath).toString().replace(/readonly/g, "");
    var sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.ES6, /*setParentNodes*/ true);
    var fileDir = path.posix.dirname(filePath);
    ts.forEachChild(sourceFile, node => {
        if (!node.importClause || !node.moduleSpecifier) return;
        var importFilename = path.posix.join(fileDir, node.moduleSpecifier.text) + ".d.ts";
        if (!imports.find(f => f.filename == importFilename) && fs.existsSync(importFilename)) {
            addWithImports({ filename: importFilename }, imports, visited);
        } else {
            importFilename = path.posix.join(fileDir, node.moduleSpecifier.text, "index.d.ts");
            var importFileDir = path.posix.dirname(importFilename);
            if (!fs.existsSync(importFilename)) return;
            var importElements = undefined;
            if (node.importClause.namedBindings.kind == ts.SyntaxKind.NamedImports && node.importClause.namedBindings.elements)
                importElements = node.importClause.namedBindings.elements.map(e => e.name.escapedText);
            var exportCode = fs.readFileSync(importFilename).toString().replace(/readonly/g, "");
            var exportSourceFile = ts.createSourceFile(importFilename, exportCode, ts.ScriptTarget.ES6, /*setParentNodes*/ true);
            ts.forEachChild(exportSourceFile, node1 => {
                if (importElements && importElements.length == 0) return;
                if (!node1.exportClause || !node1.moduleSpecifier || (node1.moduleSpecifier.text.indexOf('index') >= 0)) return
                var importFilename2 = path.posix.join(importFileDir, node1.moduleSpecifier.text) + ".d.ts";
                if (imports.find(f => f.filename == importFilename2) || !fs.existsSync(importFilename2)) return;
                var exportElements = node1.exportClause.elements
                    .filter(e => e.name && e.name.originalKeywordKind != ts.SyntaxKind.DefaultKeyword)
                    .map(e => e.name.escapedText)
                var exportExists = importElements == undefined 
                    || exportElements.find(e => importElements.indexOf(e) >= 0) !== undefined;
                if (!exportExists) return;
                addWithImports({ filename: importFilename2 }, imports, visited);
                if (importElements) 
                    importElements = importElements.filter(e => exportElements.indexOf(e) < 0);
            });
        }                
    });
    imports.push(file);
}

function convert(tsfile, fablefile) 
{
    var fabledir = path.posix.dirname(tsfile).replace(config.tsLibRoot, 'converted');
    var tsfilename = '.' + path.posix.basename(tsfile, '.d.ts');
    if (tsfilename == '.index') 
        tsfilename = (fabledir == 'converted') ? '' : ('.' + fabledir.replace('converted/', ''));
    if (!fablefile) {
        fablefile = path.posix.join(fabledir, config.importNamespace + tsfilename + '.fs');
    }

    if (convertedFiles.indexOf(fablefile) >= 0) return;

    console.log('Converting '+ tsfile + ' to ' + fablefile);
    shell.mkdir('-p', fabledir);
    shell.exec('node ' + __dirname + '/ts2fable.js ' + tsfile + ' ts2fable-config.json > ' + fablefile)
    convertedFiles.push(fablefile);
}

function deleteFile(filename)
{
    console.log('Deleting ' + filename);
    shell.rm(filename);
}

function deleteDir(dirname)
{
    console.log('Deleting ' + dirname);
    shell.rm('-r', dirname);
}

shell.exec("cat /dev/null > type-cache.json")
shell.mkdir('-p', 'converted');


var tsFiles = config.files.map(f => {
    if (f.filename)
        return f;
    else if (f.include) 
        return shell.ls(f.include).filter(fn => !f.exclude || !(new RegExp(f.exclude).exec(fn))).map(fn => { return { filename: fn }});
    else    
        return undefined;
}).reduce((flat, next) => flat.concat(next), []).filter(f => f);

var files = []
if (config.skipImports)
    files = tsFiles;
else {
    var visited = []
    tsFiles.forEach(fn => addWithImports(fn, files, visited));
}

files.forEach(fn => convert(fn.filename, fn.output));

var projSource = fs.readFileSync(config.fsprojName + ".fsproj-TEMPLATE").toString()
    .replace("[FS_FILES]", convertedFiles.map(fn => '    <Compile Include="' + fn + '" />').join("\n"));
fs.writeFileSync(config.fsprojName + ".fsproj", projSource);

shell.ls('converted/**/*.fs').filter(f => convertedFiles.indexOf(f) == -1).forEach(deleteFile);
shell.find('converted').filter(fn => fn != 'converted' && shell.test('-d', fn) && (shell.ls(fn).length == 0)).forEach(deleteDir);