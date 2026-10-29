# bash ./scripts/init-data-dir.sh
SRC="/Users/oswin902/Documents/code3/base/web/trajectory-data"

rm -rf ./data
rm -rf ./data-public

ln -s "$SRC/data" ./data
ln -s "$SRC/data-public" ./data-public

ls -l ./data
ls -l ./data-public
