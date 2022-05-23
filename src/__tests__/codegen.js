const { writeFile } = require("fs/promises");
const { resolve } = require("path");
const { readdir, readFile } = require("fs").promises;
const { createReadStream } = require("fs");
const jestConfig = require("../../jestconfig.json");

/*
To avoid repeating ourselves, the general idea is to generate the "import" tests before running the test suite, by:
- parsing every "require" tests
- replacing "require" calls with "import"
- fs.writeFile the "import" tests (overwriting those who exists)
*/

// /!\ Windows devs: please get either WSL or VirtualBox :>
const getFilenameFromPath = (path) => {
  const splittedFilename = path.split("/");
  return splittedFilename[splittedFilename.length - 1];
};

// Get array of files to ignore from /jestconfig.json
const filesToIgnore = jestConfig.testPathIgnorePatterns.map((filepath) => {
  const splittedFilename = filepath.split("/");
  return splittedFilename[splittedFilename.length - 1];
});

// List every test file "with whizbang"(tm) https://stackoverflow.com/a/45130990/11894221
const getFiles = async (dir) => {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    dirents.map((dirent) => {
      const res = resolve(dir, dirent.name);
      return dirent.isDirectory() ? getFiles(res) : res;
    }),
  );
  const testFiles = files.flat(2).filter((filepath) => {
    const filename = getFilenameFromPath(filepath);
    return (
      filename.includes(".js") && !filesToIgnore.includes(filename) && !filepath.includes("export")
    ); // whizbang++
  });
  return testFiles;
};

// Split string into an array of line & performs the relevant edits
const editString = (jsString) => {
  const lines = jsString.split("\n");
  const editedLines = lines.map((jsLine) => {
    const requireRegex = /^(?=.*\brequire\b)/g;
    if (requireRegex.test(jsLine)) {
      /* Patterns we need to handles:
				1- require("dotenv").config();
				2- const stuff = require("string");
				3- const { csv } = require("string"); 
			*/

      // Pattern 1 is easy
      if (jsLine.includes("config()")) {
        return 'import "dotenv/config";';
      } else {
        // Patterns 2 & 3 are similar: first take path
        const path = jsLine
          .slice(jsLine.indexOf("(") + 1, jsLine.indexOf(")"))
          .replace("cjs", "esm");

        // Then take stuff to import
        const stuffToImport = jsLine.split("=")[0].replace("const", "import");
        // Finally glue that together
        return `${stuffToImport}from ${path};`;
      }
    }
    // While we're at it, we edit the test description to mention being an "export" test
    else {
      return jsLine.replace(/\btest\("\b(?!\bESM:\b)/g, 'test("ESM: ');
    }
  });
  return editedLines.join("\n");
};

const codegen = async () => {
  // Get array of test files paths
  const testFiles = await getFiles("./src/__tests__/");

  // Promises must be kept preciously
  const jsStringsPromises = [];

  let longestLoc = 0;

  testFiles.forEach((file) =>
    jsStringsPromises.push(
      readFile(file, "utf-8")
        .then((string) => {
          return editString(string);
        })
        .then((editedString) => {
          const pureFilename = getFilenameFromPath(file);
          console.log("🐱 OBTW editedstring ?", `${editedString}`);

          return writeFile(`${__dirname}/import/${pureFilename}`, editedString);
        })
        .then(async (res) => {
          const pureFilename = getFilenameFromPath(file);
          const newFilePath = `${__dirname}/import/${pureFilename}`;
          function countFileLines(filePath) {
            return new Promise((resolve, reject) => {
              let lineCount = 0;
              createReadStream(filePath)
                .on("data", (buffer) => {
                  let idx = -1;
                  lineCount--; // Because the loop will run once for idx=-1
                  do {
                    idx = buffer.indexOf(10, idx + 1);
                    lineCount++;
                  } while (idx !== -1);
                })
                .on("end", () => {
                  resolve(lineCount);
                })
                .on("error", reject);
            });
          }
          const loc = await countFileLines(newFilePath);
          console.log("LOC of new file: ", loc);
          if (longestLoc < loc) longestLoc = loc;
          return res;
        })
        .catch((e) => {
          console.error("Problem in readFile.catch\n", e);
          throw e;
        }),
    ),
  );

  await Promise.all(jsStringsPromises).catch((e) => {
    console.error("Catch in promise.all", e);
    throw e;
  });
  console.log("Done rewriting 'import' tests!\nLongest LOC : ", longestLoc);
  return null;
};

codegen();