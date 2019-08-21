# apm-ui-seed
A CLI tool that generates data to develop and test features in Kibana's APM plugin.

## Requirements
- Node 8 or higher
- git

## Install 
```
yarn global add https://github.com/ogupte/apm-ui-seed/archive/master.tar.gz
```

OR

```
git clone https://github.com/ogupte/apm-ui-seed.git
cd apm-ui-seed
yarn
```
Then run scripts in the package/bin directory like:
```
bin/apm-ui-seed-geo --help
```

## Usage
This project makes the following executable scripts available:
- `apm-ui-seed-geo`

```
> apm-ui-seed-geo --help
usage: apm-ui-seed-geo [--host=<host:port>] [--index=<index>]
                       [--service-name=<name>] <commands>

Options & defaults:
   --host='localhost:9200'
    -H
   --index='apm-8.0.0-transaction'
    -i
   --service-name='client'
    -s
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
```
