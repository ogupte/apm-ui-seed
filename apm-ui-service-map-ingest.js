const parseArgs = require("minimist");
const elasticsearch = require("elasticsearch");

const argv = parseArgs(process.argv.slice(2), {
  string: ["host", "index", "service-name"],
  boolean: ["help"],
  alias: {
    help: ["h"],
    host: ["H"],
    auth: ["a"],
  },
  default: {
    host: "localhost:9200",
  }
});

const OPT_HOST = argv.host;
const OPT_AUTH = argv.auth;
const OPT_HELP = !!argv.help;
const CMD_CLEAN = argv._.includes("clean");
const CMD_HELP = argv._.includes("help");

if (OPT_HELP || CMD_HELP) {
  console.log(
    `
usage: apm-ui-service-map-ingest [--host=<host:port>]
                       [--auth=<user:password>] <commands>

Options & defaults:
   --host='localhost:9200'
    -H
   --auth
    -a
   --help
    -h

Commands:
   clean      Removes the apm_extract_destination from the apm ingest pipeline and then deletes it
   help       Shows this help message

Example:
   apm-ui-service-map-ingest
    --host='localhost:9200'
    clean
  `.trim()
  );
  process.exit(0);
}

const client = new elasticsearch.Client({
  host: OPT_HOST,
  log: "error",
  httpAuth: OPT_AUTH || undefined
});

const EXTRACT_DESTINATION_INGEST_PIPELINE_ID = 'apm_extract_destination';
const APM_INGEST_PIPELINE_ID = 'apm';                      

async function putIngestPipelineExtractDestination(client) {
  return await client.ingest.putPipeline({
    id: EXTRACT_DESTINATION_INGEST_PIPELINE_ID,
    body: {
      description: 'sets destination on ext spans based on their name',
      processors: [
        {
          set: {
            if: "ctx.span != null && ctx.span.type == 'ext'",
            field: 'span.type',
            value: 'external'
          }
        },
        {
          script: `
            if(ctx['span'] != null) {
              if (ctx['span']['type'] == 'external') {
                def spanName = ctx['span']['name'];
                if (spanName.indexOf('/') > -1) {
                  spanName = spanName.substring(0, spanName.indexOf('/'));
                }
                if (spanName.indexOf(' ') > -1) {
                  spanName = spanName.substring(spanName.indexOf(' ')+1, spanName.length());
                }
                ctx['destination.address']=spanName;
              }
              if (ctx['span']['type'] == 'resource') {
                def spanName = ctx['span']['name'];
                if (spanName.indexOf('://') > -1) {
                  spanName = spanName.substring(spanName.indexOf('://')+3, spanName.length());
                }
                if (spanName.indexOf('/') > -1) {
                  spanName = spanName.substring(0, spanName.indexOf('/'));
                }
                ctx['destination.address']=spanName;
              }
              if (ctx['span']['type'] == 'db') {
                def dest = ctx['span']['subtype'];
                ctx['destination.address']=dest;
              }
              if (ctx['span']['type'] == 'cache') {
                def dest = ctx['span']['subtype'];
                ctx['destination.address']=dest;
              }
            }
          `
        }
      ]
    }
  });
}
async function deleteIngestPipelineExtractDestination(client) {
  return await client.ingest.deletePipeline({
    id: EXTRACT_DESTINATION_INGEST_PIPELINE_ID
  });
}

async function getIngestPipelineApm(client) {
  return await client.ingest.getPipeline({
    id: APM_INGEST_PIPELINE_ID
  });
}

async function putIngestPipelineApm(
  client,
  processors
) {
  return await client.ingest.putPipeline({
    id: APM_INGEST_PIPELINE_ID,
    body: {
      description: 'Default enrichment for APM events',
      processors
    }
  });
}

async function applyExtractDestinationToApm(client) {
  let apmIngestPipeline;
  try {
    // get current apm ingest pipeline
    apmIngestPipeline = await getIngestPipelineApm(client);
  } catch (error) {
    if (error.statusCode !== 404) {
      throw error;
    }
    // create apm ingest pipeline if it doesn't exist
    return await putIngestPipelineApm(client, [
      {
        pipeline: {
          name: EXTRACT_DESTINATION_INGEST_PIPELINE_ID
        }
      }
    ]);
  }

  const {
    apm: { processors }
  } = apmIngestPipeline;

  // check if 'extract destination' processor is already applied
  if (
    processors.find(
      ({ pipeline: { name } }) =>
        name === EXTRACT_DESTINATION_INGEST_PIPELINE_ID
    )
  ) {
    return apmIngestPipeline;
  }

  // append 'extract destination' to existing processors
  return await putIngestPipelineApm(client, [
    ...processors,
    {
      pipeline: {
        name: EXTRACT_DESTINATION_INGEST_PIPELINE_ID
      }
    }
  ]);
}

async function removeExtractDestinationFromApm(client) {
  // get current apm ingest pipeline
  const apmIngestPipeline = await getIngestPipelineApm(client);

  const {
    apm: { processors }
  } = apmIngestPipeline;

  // overwrite apm ingest pipeline without the extract destination processor
  return await putIngestPipelineApm(client, [
  ...processors.filter(({ pipeline: { name } }) => name !== EXTRACT_DESTINATION_INGEST_PIPELINE_ID),
  ]);
}

async function setupIngestPipeline(client) {
  await putIngestPipelineExtractDestination(client);
  return await applyExtractDestinationToApm(client);
}

async function cleanIngestPipeline(client) {
  try {
    await removeExtractDestinationFromApm(client);
  } catch (error) {
    console.log('Unable to remove the extrat destination pipeline from the apm ingest pipeline\'s list of processors.');
    console.error(error.stack);
  }
  return await deleteIngestPipelineExtractDestination(client);
}

(async () => {
  if (CMD_CLEAN) {
    await cleanIngestPipeline(client);
  } else {
    await setupIngestPipeline(client);
  }
  process.exit(0);
})().catch(error => {
  console.trace(error.stack);
  process.exit(1);
});
