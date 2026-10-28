# bash ./scripts/init-data-dir.sh
SRC="/Users/oswin902/Documents/code3/base/web/trajectory-data"

rm -rf ./data
ln -s "$SRC/data" ./data
ls -l ./data
