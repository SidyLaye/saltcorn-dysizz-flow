/* node tests/run.cjs */
for (const t of ["engine.test.cjs", "redis.test.cjs", "templates.test.cjs", "feeds.test.cjs", "blocs2.test.cjs", "load-plugin.cjs"]) require("./" + t);
