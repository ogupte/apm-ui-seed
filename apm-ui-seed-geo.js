const parseArgs = require("minimist");
const elasticsearch = require("elasticsearch");

const argv = parseArgs(process.argv.slice(2), {
  string: ["host", "index", "service-name"],
  boolean: ["help"],
  alias: {
    help: ["h"],
    host: ["H"],
    index: ["i"],
    auth: ["a"],
    "service-name": ["s"]
  },
  default: {
    host: "localhost:9200",
    index: "apm-8.0.0-transaction",
    "service-name": "client"
  }
});

const OPT_HOST = argv.host;
const OPT_INDEX = argv.index;
const OPT_SERVICE_NAME = argv["service-name"];
const OPT_AUTH = argv.auth;
const OPT_HELP = !!argv.help;
const CMD_CLEAN = argv._.includes("clean");
const CMD_SEED = argv._.includes("seed");
const CMD_LIST = argv._.includes("list") || argv._.length === 0;
const CMD_HELP = argv._.includes("help");

if (OPT_HELP || CMD_HELP) {
  console.log(
    `
usage: apm-ui-seed-geo [--host=<host:port>] [--index=<index>]
                       [--service-name=<name>] <commands>

Options & defaults:
   --host='localhost:9200'
    -H
   --index='apm-8.0.0-transaction'
    -i
   --service-name='client'
    -s
   --auth
    -a
   --help
    -h

Commands:
   clean      Removes all page-load transaction's client.geo values
   seed       Sets client.geo.country_iso_code to a random iso2 country code
   list       *Default*: Lists all client.geo.country_iso_code, shows count &
              transaction duration average
   help       Shows this help message

Example:
   apm-ui-seed-geo
    --host='localhost:9200'
    --index='apm-8.0.0-transaction-000001'
    --service-name='client'
    clean seed list
  `.trim()
  );
  process.exit(0);
}

const client = new elasticsearch.Client({
  host: OPT_HOST,
  log: "error",
  httpAuth: OPT_AUTH || undefined
});

const cleanPageLoadClientGeo = async client => {
  const response = await client.updateByQuery({
    index: OPT_INDEX,
    waitForCompletion: true,
    waitForActiveShards: "all",
    refresh: "true",
    body: {
      query: {
        bool: {
          filter: [
            {
              term: { "service.name": OPT_SERVICE_NAME }
            },
            {
              term: { "processor.event": "transaction" }
            },
            {
              term: { "transaction.type": "page-load" }
            },
            {
              exists: { field: "client.geo.country_iso_code" }
            }
          ]
        }
      },
      script: {
        source: `ctx._source.client.remove('geo')`,
        lang: "painless"
      }
    }
  });

  console.log(`Removed client.geo for ${response.updated} documents.`);
};

const getAvailableDocumentIds = async client => {
  const body = await client.search({
    index: OPT_INDEX,
    body: {
      size: 200,
      query: {
        bool: {
          filter: [
            {
              term: { "service.name": OPT_SERVICE_NAME }
            },
            {
              term: { "processor.event": "transaction" }
            },
            {
              term: { "transaction.type": "page-load" }
            },
            {
              exists: { field: "client.ip" }
            }
          ],
          must_not: {
            exists: { field: "client.geo.country_iso_code" }
          }
        }
      },
      _source: false
    }
  });

  return body.hits.hits.map(({ _id }) => _id);
};

const countryCodes = [
  "US",
  "DK",
  "NL",
  "DE",
  "AT",
  "AU",
  "CA",
  "ES",
  "IL",
  "CH",
  "GB",
  "FR",
  "BR",
  "CN",
  "RU",
  "IN",
  "IT",
  "MX",
  "NO",
  "PL",
  "PR",
  "PT",
  "SA",
  "SE",
  "TH",
  "TR"
];

const getRandomCountryCode = () => {
  const curvedSpreadRnd = Math.random() ** 3;
  return countryCodes[Math.floor(curvedSpreadRnd * countryCodes.length)];
};

const seedBatchedCountryCodes = async (client, ids) => {
  const body = ids.reduce((body, id) => {
    return [
      ...body,
      { update: { _id: id } },
      {
        doc: { client: { geo: { country_iso_code: getRandomCountryCode() } } }
      }
    ];
  }, []);

  try {
    const response = await client.bulk({
      waitForActiveShards: "all",
      refresh: "true",
      index: OPT_INDEX,
      _source: ["client.geo.country_iso_code"],
      body
    });
    console.log(`Updated ${response.items.length} documents.`);
  } catch (e) {
    console.log(`Unable to update ${response.items.length} documents.`);
    process.exit(1);
  }
};

const seedAvailableCountryCodes = async (client, ids, allIds = []) => {
  if (ids === undefined) {
    ids = await getAvailableDocumentIds(client);
    return seedAvailableCountryCodes(client, ids);
  } else {
    if (ids.length) {
      await seedBatchedCountryCodes(client, ids);
      const nextIds = await getAvailableDocumentIds(client);
      return seedAvailableCountryCodes(client, nextIds, allIds.concat(ids));
    } else {
      console.log(
        `Finished setting random values at client.geo.country_iso_code for ${allIds.length} documents.`
      );
      return allIds;
    }
  }
};

const listAvgPageLoadByCountry = async client => {
  const body = await client.search({
    index: OPT_INDEX,
    body: {
      size: 0,
      query: {
        bool: {
          filter: [
            {
              term: { "service.name": OPT_SERVICE_NAME }
            },
            {
              term: { "processor.event": "transaction" }
            },
            {
              term: { "transaction.type": "page-load" }
            },
            {
              exists: { field: "client.geo.country_iso_code" }
            }
          ]
        }
      },
      aggs: {
        foo: {
          terms: {
            field: "client.geo.country_iso_code",
            size: countryCodes.length
          },
          aggs: {
            avg_duration: {
              avg: { field: "transaction.duration.us" }
            }
          }
        }
      }
    }
  });
  const buckets = body.aggregations.foo.buckets;
  const results = buckets.map(
    ({ key, doc_count, avg_duration: { value } }) => ({
      country_iso2_code: key,
      count: doc_count,
      avg_duration_us: Math.round(value)
    })
  );
  console.log(results);
  return results;
};

(async () => {
  if (CMD_CLEAN) {
    await cleanPageLoadClientGeo(client);
  }
  if (CMD_SEED) {
    await seedAvailableCountryCodes(client);
  }
  if (CMD_LIST) {
    await listAvgPageLoadByCountry(client);
  }
  process.exit(0);
})().catch(error => {
  console.trace(error.stack);
  process.exit(1);
});
