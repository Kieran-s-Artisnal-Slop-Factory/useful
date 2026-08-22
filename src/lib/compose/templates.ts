/**
 * Somewhere to start, and something to steal from (0.3.0 phase 13).
 *
 * Two catalogues:
 *
 *  - **Stacks** — a whole project. Loading one replaces what is open, and
 *    each offers a `.zip` with the compose file, a README and (for the ones
 *    where it makes sense) a hello-world source.
 *  - **Snippets** — one service, INJECTED into whatever is open rather than
 *    replacing it, bringing whatever network or volume it needs with it.
 *
 * **Every image tag here is pinned, and every tag moves.** A pinned tag is a
 * promise about today, not about next year: `postgres:16-alpine` gets security
 * updates under the same name, and `node:22-alpine` will one day be a Node 22
 * nobody tested this against. Each card says so, because a template that
 * looks authoritative is worse than one that admits its age.
 *
 * Sources are vendored only where the framework has no scaffolder of its own
 * worth deferring to (Q10). Astro, Next.js and Django ship README steps that
 * run their own `create` command instead — vendored scaffolding is stale
 * within a release, and a stale scaffold that silently works is worse than a
 * command that is always current.
 */
import {
  newMount,
  newNetwork,
  newPort,
  newSecret,
  newService,
  newVolume,
  uniqueName,
  type ComposeProjectModel,
  type ComposeService,
} from './model';

export interface ArchiveFile {
  name: string;
  content: string;
}

export interface StackTemplate {
  id: string;
  label: string;
  /** One line for the card. */
  note: string;
  /** Every image tag this pins, listed on the card. */
  pins: string[];
  build: () => ComposeProjectModel;
  /** Sources shipped in the archive, beside the compose file and README. */
  files?: ArchiveFile[];
  /** Steps for the README where the framework scaffolds itself. */
  steps?: string[];
}

export interface ServiceSnippet {
  id: string;
  label: string;
  note: string;
  pins: string[];
  build: () => ComposeService;
  /** Volumes this service needs; added if the project has not got them. */
  volumes?: string[];
}

const svc = (name: string, image: string, edit?: (s: ComposeService) => void): ComposeService => {
  const s = newService(name);
  s.image = image;
  s.restart = 'unless-stopped';
  edit?.(s);
  return s;
};

const port = (published: string, target: string) => ({ ...newPort(), published, target });
const bind = (source: string, target: string, readOnly = false) => ({
  ...newMount('bind'),
  source,
  target,
  readOnly,
});
const volume = (source: string, target: string) => ({ ...newMount('volume'), source, target });

const project = (
  name: string,
  services: ComposeService[],
  extras: Partial<ComposeProjectModel> = {}
): ComposeProjectModel => ({
  name,
  services,
  networks: [],
  volumes: [],
  secrets: [],
  configs: [],
  ...extras,
});

// ---- shared file bodies -----------------------------------------------------

const DOCKERIGNORE = ['node_modules', '.git', '.env', '__pycache__', '*.pyc', 'dist', '.venv', ''].join('\n');

const ENV_EXAMPLE = (lines: string[]): string =>
  ['# Copy to .env and fill in. .env is gitignored; this file is not.', ...lines, ''].join('\n');

// ---- the stacks -------------------------------------------------------------

export const STACKS: StackTemplate[] = [
  {
    id: 'wordpress',
    label: 'WordPress + MySQL',
    note: 'The classic pair, with the database on a private network and a named volume each.',
    pins: ['wordpress:6.7-php8.3-apache', 'mysql:8.4'],
    build: () =>
      project(
        'wordpress',
        [
          svc('wordpress', 'wordpress:6.7-php8.3-apache', (s) => {
            s.ports = [port('8080', '80')];
            s.environment = [
              { key: 'WORDPRESS_DB_HOST', value: 'db' },
              { key: 'WORDPRESS_DB_USER', value: 'wordpress' },
              { key: 'WORDPRESS_DB_PASSWORD', value: '${DB_PASSWORD:?set DB_PASSWORD in .env}' },
              { key: 'WORDPRESS_DB_NAME', value: 'wordpress' },
            ];
            s.volumes = [volume('wp_content', '/var/www/html/wp-content')];
            s.networks = ['backend'];
            s.dependsOn = [{ service: 'db', condition: 'service_healthy', required: true, restart: false }];
          }),
          svc('db', 'mysql:8.4', (s) => {
            s.environment = [
              { key: 'MYSQL_DATABASE', value: 'wordpress' },
              { key: 'MYSQL_USER', value: 'wordpress' },
              { key: 'MYSQL_PASSWORD', value: '${DB_PASSWORD:?set DB_PASSWORD in .env}' },
              { key: 'MYSQL_ROOT_PASSWORD', value: '${DB_ROOT_PASSWORD:?set DB_ROOT_PASSWORD in .env}' },
            ];
            s.volumes = [volume('db_data', '/var/lib/mysql')];
            s.networks = ['backend'];
            s.healthcheck = {
              ...s.healthcheck,
              enabled: true,
              test: 'mysqladmin ping -h 127.0.0.1 --silent',
              interval: '10s',
              timeout: '5s',
              retries: '10',
              startPeriod: '30s',
            };
          }),
        ],
        { networks: [newNetwork('backend')], volumes: [newVolume('wp_content'), newVolume('db_data')] }
      ),
    files: [
      { name: '.env.example', content: ENV_EXAMPLE(['DB_PASSWORD=', 'DB_ROOT_PASSWORD=']) },
      { name: '.dockerignore', content: DOCKERIGNORE },
    ],
  },
  {
    id: 'flask',
    label: 'Flask + PostgreSQL',
    note: 'A Python app mounted from the host, so an edit is a reload.',
    pins: ['python:3.13-slim', 'postgres:17-alpine'],
    build: () =>
      project(
        'flask-app',
        [
          svc('web', 'python:3.13-slim', (s) => {
            s.workingDir = '/app';
            s.command = 'sh -c "pip install --no-cache-dir -r requirements.txt && flask run --host 0.0.0.0"';
            s.ports = [port('5000', '5000')];
            s.environment = [
              { key: 'FLASK_APP', value: 'app.py' },
              { key: 'FLASK_DEBUG', value: '1' },
              { key: 'DATABASE_URL', value: 'postgresql://app:${DB_PASSWORD:-devpassword}@db:5432/app' },
            ];
            s.volumes = [bind('./app', '/app')];
            s.networks = ['backend'];
            s.dependsOn = [{ service: 'db', condition: 'service_healthy', required: true, restart: false }];
          }),
          svc('db', 'postgres:17-alpine', (s) => {
            s.environment = [
              { key: 'POSTGRES_USER', value: 'app' },
              { key: 'POSTGRES_PASSWORD', value: '${DB_PASSWORD:-devpassword}' },
              { key: 'POSTGRES_DB', value: 'app' },
            ];
            s.volumes = [volume('pg_data', '/var/lib/postgresql/data')];
            s.networks = ['backend'];
            s.healthcheck = {
              ...s.healthcheck,
              enabled: true,
              test: 'pg_isready -U app -d app',
              interval: '10s',
              timeout: '5s',
              retries: '5',
              startPeriod: '20s',
            };
          }),
        ],
        { networks: [newNetwork('backend')], volumes: [newVolume('pg_data')] }
      ),
    files: [
      {
        name: 'app/app.py',
        content: [
          'import os',
          '',
          'from flask import Flask',
          '',
          'app = Flask(__name__)',
          '',
          '',
          '@app.get("/")',
          'def index():',
          '    return {"hello": "world", "database": os.environ.get("DATABASE_URL", "unset")}',
          '',
        ].join('\n'),
      },
      { name: 'app/requirements.txt', content: 'flask==3.1.0\npsycopg[binary]==3.2.3\n' },
      { name: '.env.example', content: ENV_EXAMPLE(['DB_PASSWORD=devpassword']) },
      { name: '.dockerignore', content: DOCKERIGNORE },
    ],
  },
  {
    id: 'fastapi',
    label: 'FastAPI + PostgreSQL',
    note: 'uvicorn with reload, and a database that is waited on properly.',
    pins: ['python:3.13-slim', 'postgres:17-alpine'],
    build: () =>
      project(
        'fastapi-app',
        [
          svc('api', 'python:3.13-slim', (s) => {
            s.workingDir = '/app';
            s.command =
              'sh -c "pip install --no-cache-dir -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port 8000 --reload"';
            s.ports = [port('8000', '8000')];
            s.environment = [
              { key: 'DATABASE_URL', value: 'postgresql://app:${DB_PASSWORD:-devpassword}@db:5432/app' },
            ];
            s.volumes = [bind('./app', '/app')];
            s.networks = ['backend'];
            s.dependsOn = [{ service: 'db', condition: 'service_healthy', required: true, restart: false }];
          }),
          svc('db', 'postgres:17-alpine', (s) => {
            s.environment = [
              { key: 'POSTGRES_USER', value: 'app' },
              { key: 'POSTGRES_PASSWORD', value: '${DB_PASSWORD:-devpassword}' },
              { key: 'POSTGRES_DB', value: 'app' },
            ];
            s.volumes = [volume('pg_data', '/var/lib/postgresql/data')];
            s.networks = ['backend'];
            s.healthcheck = {
              ...s.healthcheck,
              enabled: true,
              test: 'pg_isready -U app -d app',
              interval: '10s',
              timeout: '5s',
              retries: '5',
            };
          }),
        ],
        { networks: [newNetwork('backend')], volumes: [newVolume('pg_data')] }
      ),
    files: [
      {
        name: 'app/main.py',
        content: [
          'import os',
          '',
          'from fastapi import FastAPI',
          '',
          'app = FastAPI()',
          '',
          '',
          '@app.get("/")',
          'async def index():',
          '    return {"hello": "world", "database": os.environ.get("DATABASE_URL", "unset")}',
          '',
        ].join('\n'),
      },
      { name: 'app/requirements.txt', content: 'fastapi==0.115.6\nuvicorn[standard]==0.34.0\n' },
      { name: '.env.example', content: ENV_EXAMPLE(['DB_PASSWORD=devpassword']) },
      { name: '.dockerignore', content: DOCKERIGNORE },
    ],
  },
  {
    id: 'node',
    label: 'Node.js + Redis',
    note: 'A plain HTTP server with a cache beside it — no framework to go stale.',
    pins: ['node:22-alpine', 'redis:7.4-alpine'],
    build: () =>
      project(
        'node-app',
        [
          svc('app', 'node:22-alpine', (s) => {
            s.workingDir = '/app';
            s.command = 'node server.js';
            s.ports = [port('3000', '3000')];
            s.environment = [{ key: 'REDIS_URL', value: 'redis://cache:6379' }];
            s.volumes = [bind('./app', '/app')];
            s.networks = ['backend'];
            s.dependsOn = [{ service: 'cache', condition: 'service_started', required: true, restart: false }];
          }),
          svc('cache', 'redis:7.4-alpine', (s) => {
            s.networks = ['backend'];
            s.volumes = [volume('redis_data', '/data')];
            s.healthcheck = { ...s.healthcheck, enabled: true, test: 'redis-cli ping', interval: '10s', retries: '5' };
          }),
        ],
        { networks: [newNetwork('backend')], volumes: [newVolume('redis_data')] }
      ),
    files: [
      {
        name: 'app/server.js',
        content: [
          "import { createServer } from 'node:http';",
          '',
          'const port = Number(process.env.PORT ?? 3000);',
          '',
          'createServer((request, response) => {',
          "  response.writeHead(200, { 'content-type': 'application/json' });",
          "  response.end(JSON.stringify({ hello: 'world', redis: process.env.REDIS_URL ?? 'unset' }));",
          '}).listen(port, () => console.log(`listening on ${port}`));',
          '',
        ].join('\n'),
      },
      {
        name: 'app/package.json',
        content: `${JSON.stringify({ name: 'node-app', private: true, type: 'module', scripts: { start: 'node server.js' } }, null, 2)}\n`,
      },
      { name: '.dockerignore', content: DOCKERIGNORE },
    ],
  },
  {
    id: 'mern',
    label: 'MERN (Mongo + Express + React)',
    note: 'An API and a database; the React app is whatever you put in ./client.',
    pins: ['node:22-alpine', 'mongo:8.0'],
    build: () =>
      project(
        'mern-app',
        [
          svc('api', 'node:22-alpine', (s) => {
            s.workingDir = '/app';
            s.command = 'sh -c "npm install && node server.js"';
            s.ports = [port('4000', '4000')];
            s.environment = [{ key: 'MONGO_URL', value: 'mongodb://db:27017/app' }];
            s.volumes = [bind('./api', '/app')];
            s.networks = ['backend'];
            s.dependsOn = [{ service: 'db', condition: 'service_started', required: true, restart: false }];
          }),
          svc('db', 'mongo:8.0', (s) => {
            s.networks = ['backend'];
            s.volumes = [volume('mongo_data', '/data/db')];
          }),
        ],
        { networks: [newNetwork('backend')], volumes: [newVolume('mongo_data')] }
      ),
    files: [
      {
        name: 'api/server.js',
        content: [
          "import express from 'express';",
          '',
          'const app = express();',
          '',
          "app.get('/', (_request, response) =>",
          "  response.json({ hello: 'world', mongo: process.env.MONGO_URL ?? 'unset' })",
          ');',
          '',
          'app.listen(4000, () => console.log(`listening on 4000`));',
          '',
        ].join('\n'),
      },
      {
        name: 'api/package.json',
        content: `${JSON.stringify(
          { name: 'mern-api', private: true, type: 'module', dependencies: { express: '^4.21.2' } },
          null,
          2
        )}\n`,
      },
      { name: '.dockerignore', content: DOCKERIGNORE },
    ],
    steps: [
      'The React half is not vendored, because `create-vite` is always newer than anything shipped here:',
      '',
      '    npm create vite@latest client -- --template react',
      '',
      'Then point it at http://localhost:4000 for the API.',
    ],
  },
  {
    id: 'go',
    label: 'Go HTTP server',
    note: 'The standard library and nothing else — no dependencies to pin.',
    pins: ['golang:1.23-alpine'],
    build: () =>
      project('go-app', [
        svc('app', 'golang:1.23-alpine', (s) => {
          s.workingDir = '/src';
          s.command = 'go run .';
          s.ports = [port('8080', '8080')];
          s.volumes = [bind('./src', '/src')];
        }),
      ]),
    files: [
      {
        name: 'src/main.go',
        content: [
          'package main',
          '',
          'import (',
          '\t"encoding/json"',
          '\t"log"',
          '\t"net/http"',
          ')',
          '',
          'func main() {',
          '\thttp.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {',
          '\t\tw.Header().Set("content-type", "application/json")',
          '\t\tjson.NewEncoder(w).Encode(map[string]string{"hello": "world"})',
          '\t})',
          '',
          '\tlog.Println("listening on 8080")',
          '\tlog.Fatal(http.ListenAndServe(":8080", nil))',
          '}',
          '',
        ].join('\n'),
      },
      { name: 'src/go.mod', content: 'module app\n\ngo 1.23\n' },
      { name: '.dockerignore', content: DOCKERIGNORE },
    ],
  },
  {
    id: 'django',
    label: 'Django + PostgreSQL',
    note: 'Scaffolded by Django itself — see the README, not a vendored copy.',
    pins: ['python:3.13-slim', 'postgres:17-alpine'],
    build: () =>
      project(
        'django-app',
        [
          svc('web', 'python:3.13-slim', (s) => {
            s.workingDir = '/app';
            s.command = 'sh -c "pip install --no-cache-dir -r requirements.txt && python manage.py runserver 0.0.0.0:8000"';
            s.ports = [port('8000', '8000')];
            s.environment = [
              { key: 'DATABASE_URL', value: 'postgresql://app:${DB_PASSWORD:-devpassword}@db:5432/app' },
              { key: 'DJANGO_DEBUG', value: '1' },
            ];
            s.volumes = [bind('./app', '/app')];
            s.networks = ['backend'];
            s.dependsOn = [{ service: 'db', condition: 'service_healthy', required: true, restart: false }];
          }),
          svc('db', 'postgres:17-alpine', (s) => {
            s.environment = [
              { key: 'POSTGRES_USER', value: 'app' },
              { key: 'POSTGRES_PASSWORD', value: '${DB_PASSWORD:-devpassword}' },
              { key: 'POSTGRES_DB', value: 'app' },
            ];
            s.volumes = [volume('pg_data', '/var/lib/postgresql/data')];
            s.networks = ['backend'];
            s.healthcheck = {
              ...s.healthcheck,
              enabled: true,
              test: 'pg_isready -U app -d app',
              interval: '10s',
              retries: '5',
            };
          }),
        ],
        { networks: [newNetwork('backend')], volumes: [newVolume('pg_data')] }
      ),
    files: [
      { name: 'app/requirements.txt', content: 'django==5.1.4\npsycopg[binary]==3.2.3\n' },
      { name: '.env.example', content: ENV_EXAMPLE(['DB_PASSWORD=devpassword']) },
      { name: '.dockerignore', content: DOCKERIGNORE },
    ],
    steps: [
      'Django scaffolds itself, and its own generator is always newer than anything vendored here:',
      '',
      '    docker compose run --rm web django-admin startproject config .',
      '',
      'Then point `DATABASES` at `DATABASE_URL`, and:',
      '',
      '    docker compose run --rm web python manage.py migrate',
    ],
  },
  {
    id: 'astro',
    label: 'Astro',
    note: 'The dev server in a container; the site itself comes from `create astro`.',
    pins: ['node:22-alpine'],
    build: () =>
      project('astro-site', [
        svc('site', 'node:22-alpine', (s) => {
          s.workingDir = '/app';
          s.command = 'sh -c "npm install && npm run dev -- --host 0.0.0.0"';
          s.ports = [port('4321', '4321')];
          s.volumes = [bind('./site', '/app'), volume('node_modules', '/app/node_modules')];
        }),
      ], { volumes: [newVolume('node_modules')] }),
    steps: [
      "Astro's scaffolder moves faster than any copy shipped here, so run its own:",
      '',
      '    npm create astro@latest site',
      '',
      'Then `docker compose up` and open http://localhost:4321.',
      '',
      'The anonymous `node_modules` volume is deliberate: without it the bind mount hides the',
      'container-installed modules with whatever is (or is not) on the host.',
    ],
    files: [{ name: '.dockerignore', content: DOCKERIGNORE }],
  },
  {
    id: 'nextjs',
    label: 'Next.js',
    note: 'Same shape as Astro — the container runs the dev server, the app is scaffolded.',
    pins: ['node:22-alpine'],
    build: () =>
      project('next-app', [
        svc('web', 'node:22-alpine', (s) => {
          s.workingDir = '/app';
          s.command = 'sh -c "npm install && npm run dev"';
          s.ports = [port('3000', '3000')];
          s.environment = [{ key: 'HOSTNAME', value: '0.0.0.0' }];
          s.volumes = [bind('./web', '/app'), volume('node_modules', '/app/node_modules')];
        }),
      ], { volumes: [newVolume('node_modules')] }),
    steps: [
      'Next.js scaffolds itself, and its generator is always newer than a vendored copy:',
      '',
      '    npx create-next-app@latest web',
      '',
      'Then `docker compose up` and open http://localhost:3000.',
    ],
    files: [{ name: '.dockerignore', content: DOCKERIGNORE }],
  },
];

// ---- the snippets -----------------------------------------------------------

export const SNIPPETS: ServiceSnippet[] = [
  {
    id: 'postgres',
    label: 'PostgreSQL',
    note: 'With a healthcheck, so `depends_on` can actually wait for it.',
    pins: ['postgres:17-alpine'],
    volumes: ['pg_data'],
    build: () =>
      svc('db', 'postgres:17-alpine', (s) => {
        s.environment = [
          { key: 'POSTGRES_USER', value: 'app' },
          { key: 'POSTGRES_PASSWORD', value: '${DB_PASSWORD:-devpassword}' },
          { key: 'POSTGRES_DB', value: 'app' },
        ];
        s.volumes = [volume('pg_data', '/var/lib/postgresql/data')];
        s.healthcheck = {
          ...s.healthcheck,
          enabled: true,
          test: 'pg_isready -U app -d app',
          interval: '10s',
          timeout: '5s',
          retries: '5',
        };
      }),
  },
  {
    id: 'redis',
    label: 'Redis',
    note: 'Persistent, with a ping healthcheck.',
    pins: ['redis:7.4-alpine'],
    volumes: ['redis_data'],
    build: () =>
      svc('cache', 'redis:7.4-alpine', (s) => {
        s.command = 'redis-server --save 60 1 --loglevel warning';
        s.volumes = [volume('redis_data', '/data')];
        s.healthcheck = { ...s.healthcheck, enabled: true, test: 'redis-cli ping', interval: '10s', retries: '5' };
      }),
  },
  {
    id: 'valkey',
    label: 'Valkey',
    note: "Redis's BSD-licensed fork, drop-in compatible.",
    pins: ['valkey/valkey:8.0-alpine'],
    volumes: ['valkey_data'],
    build: () =>
      svc('cache', 'valkey/valkey:8.0-alpine', (s) => {
        s.command = 'valkey-server --save 60 1 --loglevel warning';
        s.volumes = [volume('valkey_data', '/data')];
        s.healthcheck = { ...s.healthcheck, enabled: true, test: 'valkey-cli ping', interval: '10s', retries: '5' };
      }),
  },
  {
    id: 'flask',
    label: 'Flask',
    note: 'Mounted from ./app, installing requirements on start.',
    pins: ['python:3.13-slim'],
    build: () =>
      svc('web', 'python:3.13-slim', (s) => {
        s.workingDir = '/app';
        s.command = 'sh -c "pip install --no-cache-dir -r requirements.txt && flask run --host 0.0.0.0"';
        s.ports = [port('5000', '5000')];
        s.environment = [{ key: 'FLASK_APP', value: 'app.py' }];
        s.volumes = [bind('./app', '/app')];
      }),
  },
  {
    id: 'fastapi',
    label: 'FastAPI',
    note: 'uvicorn with --reload, mounted from ./app.',
    pins: ['python:3.13-slim'],
    build: () =>
      svc('api', 'python:3.13-slim', (s) => {
        s.workingDir = '/app';
        s.command =
          'sh -c "pip install --no-cache-dir -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port 8000 --reload"';
        s.ports = [port('8000', '8000')];
        s.volumes = [bind('./app', '/app')];
      }),
  },
  {
    id: 'nextjs',
    label: 'Next.js',
    note: 'Dev server, with the node_modules volume that stops the bind hiding them.',
    pins: ['node:22-alpine'],
    volumes: ['node_modules'],
    build: () =>
      svc('web', 'node:22-alpine', (s) => {
        s.workingDir = '/app';
        s.command = 'sh -c "npm install && npm run dev"';
        s.ports = [port('3000', '3000')];
        s.environment = [{ key: 'HOSTNAME', value: '0.0.0.0' }];
        s.volumes = [bind('./web', '/app'), volume('node_modules', '/app/node_modules')];
      }),
  },
  {
    id: 'sveltekit',
    label: 'SvelteKit',
    note: 'Vite dev server bound to every interface, so the port publishes.',
    pins: ['node:22-alpine'],
    volumes: ['node_modules'],
    build: () =>
      svc('web', 'node:22-alpine', (s) => {
        s.workingDir = '/app';
        s.command = 'sh -c "npm install && npm run dev -- --host 0.0.0.0"';
        s.ports = [port('5173', '5173')];
        s.volumes = [bind('./web', '/app'), volume('node_modules', '/app/node_modules')];
      }),
  },
  {
    id: 'tanstack',
    label: 'TanStack Start',
    note: 'Same shape as the other Vite-based dev servers.',
    pins: ['node:22-alpine'],
    volumes: ['node_modules'],
    build: () =>
      svc('web', 'node:22-alpine', (s) => {
        s.workingDir = '/app';
        s.command = 'sh -c "npm install && npm run dev -- --host 0.0.0.0"';
        s.ports = [port('3000', '3000')];
        s.volumes = [bind('./web', '/app'), volume('node_modules', '/app/node_modules')];
      }),
  },
  {
    id: 'go-stdlib',
    label: 'Go (standard library)',
    note: '`go run .` over a bind mount — no dependencies at all.',
    pins: ['golang:1.23-alpine'],
    build: () =>
      svc('app', 'golang:1.23-alpine', (s) => {
        s.workingDir = '/src';
        s.command = 'go run .';
        s.ports = [port('8080', '8080')];
        s.volumes = [bind('./src', '/src')];
      }),
  },
  {
    id: 'go-fiber',
    label: 'Go (Fiber)',
    note: 'Same as the stdlib one; Fiber comes from go.mod.',
    pins: ['golang:1.23-alpine'],
    build: () =>
      svc('app', 'golang:1.23-alpine', (s) => {
        s.workingDir = '/src';
        s.command = 'sh -c "go mod download && go run ."';
        s.ports = [port('3000', '3000')];
        s.volumes = [bind('./src', '/src')];
      }),
  },
];

// ---- injection --------------------------------------------------------------

export interface InjectionResult {
  project: ComposeProjectModel;
  /** What was added and what had to move, for the receipt the page shows. */
  added: {
    service: string;
    volumes: string[];
    ports: { from: string; to: string }[];
  };
}

/**
 * Add a snippet's service to an open project.
 *
 * Three things it does that a naive splice does not, and each is a stack that
 * would not start otherwise:
 *
 *  - **renames** when the service name is taken — Compose keys services by
 *    name, so a collision silently replaces the first one and nothing says so;
 *  - **declares** any volume the snippet mounts, since an undeclared volume
 *    fails validation the moment it lands;
 *  - **moves the host port** when something already publishes it. Two
 *    containers cannot bind one host port: the second fails at `up` time with
 *    an error about the address being in use, which is a confusing thing to
 *    get from clicking "add Redis". Only the HOST side moves; the container
 *    port is part of the image's contract.
 */
export function injectSnippet(project: ComposeProjectModel, snippet: ServiceSnippet): InjectionResult {
  const service = snippet.build();
  service.name = uniqueName(
    service.name,
    project.services.map((s) => s.name)
  );

  const declared = new Set(project.volumes.map((v) => v.name));
  const addedVolumes: string[] = [];
  for (const name of snippet.volumes ?? []) {
    if (declared.has(name)) continue;
    declared.add(name);
    addedVolumes.push(name);
  }

  const taken = new Set(
    project.services.flatMap((s) =>
      s.networkMode.trim() === 'host'
        ? []
        : s.ports
            .filter((p) => /^\d+$/.test(p.published.trim()))
            .map((p) => `${p.published.trim()}/${p.protocol}`)
    )
  );
  const movedPorts: { from: string; to: string }[] = [];
  for (const port of service.ports) {
    const published = port.published.trim();
    // A range is left exactly as written: bumping one end of it silently
    // is a worse surprise than the collision warning the validator gives.
    if (!/^\d+$/.test(published)) continue;
    let candidate = Number(published);
    if (taken.has(`${candidate}/${port.protocol}`)) {
      while (taken.has(`${candidate}/${port.protocol}`) && candidate < 65_535) candidate += 1;
      movedPorts.push({ from: published, to: String(candidate) });
      port.published = String(candidate);
    }
    taken.add(`${candidate}/${port.protocol}`);
  }

  return {
    project: {
      ...project,
      services: [...project.services, service],
      volumes: [...project.volumes, ...addedVolumes.map((name) => newVolume(name))],
    },
    added: { service: service.name, volumes: addedVolumes, ports: movedPorts },
  };
}

export const stackById = (id: string): StackTemplate | undefined => STACKS.find((s) => s.id === id);
export const snippetById = (id: string): ServiceSnippet | undefined => SNIPPETS.find((s) => s.id === id);
