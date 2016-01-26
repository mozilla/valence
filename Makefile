FILES=data lib package.json README.md bootstrap.js
ADDON_NAME=valence
ADDON_VERSION=0.3.4pre
XPI_NAME=$(ADDON_NAME)-$(ADDON_VERSION)
SOURCE_ZIPFILE=$(XPI_NAME)-sources.zip

REMOTE_ROOT_PATH=/pub/labs/valence/

UPDATE_LINK=https://ftp.mozilla.org$(REMOTE_ROOT_PATH)
UPDATE_URL=$(UPDATE_LINK)

S3_BASE_URL=s3://net-mozaws-prod-delivery-contrib$(REMOTE_ROOT_PATH)

XPIS = $(XPI_NAME)-win32.xpi $(XPI_NAME)-linux32.xpi $(XPI_NAME)-linux64.xpi $(XPI_NAME)-mac64.xpi

all: $(XPIS)

define build-xpi
	echo "build xpi for $1";
	mv install.rdf jpm_install.rdf
	sed -e 's#@@UPDATE_URL@@#$(UPDATE_URL)$1/update.rdf#;s#@@ADDON_VERSION@@#$(ADDON_VERSION)#' template/install.rdf > install.rdf
	zip $(XPI_NAME)-$1.xpi -r $2 install.rdf
	mv jpm_install.rdf install.rdf
endef

bootstrap.js: template
	cp template/bootstrap.js bootstrap.js

$(XPI_NAME)-win32.xpi: $(FILES) tools/win32
	@$(call build-xpi,win32, $^)

$(XPI_NAME)-linux32.xpi: $(FILES) tools/linux32 tools/linux64
	@$(call build-xpi,linux32, $^)

$(XPI_NAME)-linux64.xpi: $(FILES) tools/linux32 tools/linux64
	@$(call build-xpi,linux64, $^)

$(XPI_NAME)-mac64.xpi: $(FILES) tools/mac64
	@$(call build-xpi,mac64, $^)

clean:
	rm -f *.xpi
	rm -f update.rdf bootstrap.js

define release
  echo "releasing $1"
	aws s3 cp $(XPI_NAME)-$1.xpi $(S3_BASE_URL)$1/$(XPI_NAME)-$1.xpi
  # Update the "latest" symbolic link with a copy inside s3
	aws s3 cp $(S3_BASE_URL)$1/$(XPI_NAME)-$1.xpi $(S3_BASE_URL)$1/$(ADDON_NAME)-$1-latest.xpi
  # Update a "latest" symbolic link with a copy inside s3 for compat with Fx 39 and earlier
	aws s3 cp $(S3_BASE_URL)$1/$(XPI_NAME)-$1.xpi $(S3_BASE_URL)$1/fxdt-adapters-$1-latest.xpi
  # Update the update manifest
	sed -e 's#@@UPDATE_LINK@@#$(UPDATE_LINK)$1/$(XPI_NAME)-$1.xpi#;s#@@ADDON_VERSION@@#$(ADDON_VERSION)#' template/update.rdf > update.rdf
	aws s3 cp --cache-control max-age=3600 update.rdf $(S3_BASE_URL)$1/update.rdf
endef

release: $(XPIS) archive-sources
	@$(call release,win32)
	@$(call release,linux32)
	@$(call release,linux64)
	@$(call release,mac64)
	aws s3 cp ../$(SOURCE_ZIPFILE) $(S3_BASE_URL)sources/$(SOURCE_ZIPFILE)
	# Update latest with a copy inside s3
	aws s3 cp $(S3_BASE_URL)sources/$(SOURCE_ZIPFILE) $(S3_BASE_URL)sources/$(ADDON_NAME)-latest-sources.zip

# Expects to find the following directories in the same level as this one:
#
# ios-webkit-debug-proxy (https://github.com/google/ios-webkit-debug-proxy)
# ios-webkit-debug-proxy-win32 (https://github.com/artygus/ios-webkit-debug-proxy-win32)
# libimobiledevice (https://github.com/libimobiledevice/libimobiledevice)
# libplist (https://github.com/libimobiledevice/libplist)
# libusbmuxd (https://github.com/libimobiledevice/libusbmuxd)
# openssl (https://github.com/openssl/openssl)
# libxml2 (git://git.gnome.org/libxml2.git)
# libiconv (git://git.savannah.gnu.org/libiconv.git)
# pcre (svn://vcs.exim.org/pcre2/code/trunk)
# zlib (http://zlib.net/)
archive-sources:
	@echo "archiving $1 sources"
	@echo "(make sure you have run 'make distclean' in all dependencies!)"
	rm -f ../$(SOURCE_ZIPFILE)
	cd .. && zip -qx \*.git\* -r $(SOURCE_ZIPFILE) $(ADDON_NAME)
	cd .. && zip -qx \*.git\* -r $(SOURCE_ZIPFILE) ios-webkit-debug-proxy
	cd .. && zip -qx \*.git\* -r $(SOURCE_ZIPFILE) ios-webkit-debug-proxy-win32
	cd .. && zip -qx \*.git\* -r $(SOURCE_ZIPFILE) libimobiledevice
	cd .. && zip -qx \*.git\* -r $(SOURCE_ZIPFILE) libplist
	cd .. && zip -qx \*.git\* -r $(SOURCE_ZIPFILE) libusbmuxd
	cd .. && zip -qx \*.git\* -r $(SOURCE_ZIPFILE) openssl
	cd .. && zip -qx \*.git\* -r $(SOURCE_ZIPFILE) libxml2
	cd .. && zip -qx \*.git\* -r $(SOURCE_ZIPFILE) libiconv
	cd .. && zip -qx \*.git\* -r $(SOURCE_ZIPFILE) pcre
	cd .. && zip -qx \*.git\* -r $(SOURCE_ZIPFILE) zlib
