const fs = require("fs");
const process = require("process");

const walk = function(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
      file = dir + '/' + file;
      const stat = fs.statSync(file);
      if (stat && stat.isDirectory()) {
          results = results.concat(walk(file));
      } else {
          results.push(file);
      }
  });
  return results;
};

const contents = new Map();

const serverPath = p => '/' + p.slice(2);

function hashAndCache(p) {
  const content = fs.readFileSync(p, 'UTF-8');

  contents.set(serverPath(p), content);

  return require("md5")(content);
}

function getContentType(id) {
  if (/\.(js|ellx)$/.test(id)) {
    return 'text/javascript';
  }
  if (/\.(md)$/.test(id)) {
    return 'text/plain';
  }
  return 'text/plain';
}

async function sync(repo, server)  {
  const fetch = require("node-fetch");

  const files = walk('.')
    .filter(name => !name.startsWith('./.git'))
    .map(path => ({
      path: serverPath(path),
      hash: hashAndCache(path),
    }));

  const authorization = `${repo.split('/')[0]},${repo.replace('/', '-')},${process.env.TS},${process.env.ELLX_KEY}`;

  const res = await fetch(
    server + `/sync/${repo}`,
    {
      method: 'PUT',
      body: JSON.stringify({ files, title: 'test', acl: 'public' }),
      // TODO: auth header from env
      // for now need to copy valid token from client
      headers: {
        authorization,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    const message = await res.json();
    console.error(res.status, message.error ? message.error : message);
    return;
  }

  const urls = await res.json();

  const uploads = await Promise.all(
    urls.map(
      async ({ path, uploadUrl }) => fetch(uploadUrl, {
        method: 'PUT',
        body: contents.get(path),
        headers: {
          'Content-Type': getContentType(path),
          'Cache-Control': 'max-age=31536000'
        },
      })
    )
  );

  if (uploads.every(i => i.ok)) {
    console.log(
      'Synced following files successfully:\n',
    );
    console.log(
      urls.map(({ path }) => path.slice(1)).join('\n')
    );

    process.exit(0);
  } else {
    console.log(
      'Error uploading files',
      await Promise.all(uploads.map(async r => r.json()))
    );
    process.exit(1);
  }
}

try {
  // from https://help.github.com/en/actions/configuring-and-managing-workflows/using-environment-variables
  sync(process.env.GITHUB_REPOSITORY, process.env.ELLX_URL || 'https://api.ellx.io');
} catch (e) {
  console.error('Unexpected error', e);

  process.exit(1);
}
