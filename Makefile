FILES=data lib package.json README.md bootstrap.js
ADDON_NAME=fxdt-adapters
ADDON_VERSION=0.0.2pre
XPI_NAME=$(ADDON_NAME)-$(ADDON_VERSION)

FTP_ROOT_PATH=/pub/mozilla.org/labs/fxdt-adapters

UPDATE_LINK=https://ftp.mozilla.org$(FTP_ROOT_PATH)/
UPDATE_URL=$(UPDATE_LINK)

XPIS = $(XPI_NAME)-win32.xpi $(XPI_NAME)-linux32.xpi $(XPI_NAME)-linux64.xpi $(XPI_NAME)-mac64.xpi

all: $(XPIS)

define build-xpi
	echo "build xpi for $1";
	sed -e 's#@@UPDATE_URL@@#$(UPDATE_URL)$1/update.rdf#;s#@@ADDON_VERSION@@#$(ADDON_VERSION)#' template/install.rdf > install.rdf
	zip $(XPI_NAME)-$1.xpi -r $2 install.rdf
endef

bootstrap.js:
	cp template/bootstrap.js bootstrap.js

$(XPI_NAME)-win32.xpi: $(FILES)
	@$(call build-xpi,win32, $^)

$(XPI_NAME)-linux32.xpi: $(FILES)
	@$(call build-xpi,linux32, $^)

$(XPI_NAME)-linux64.xpi: $(FILES)
	@$(call build-xpi,linux64, $^)

$(XPI_NAME)-mac64.xpi: $(FILES)
	@$(call build-xpi,mac64, $^)

clean:
	rm -f *.xpi
	rm -f update.rdf install.rdf bootstrap.js

define release
  echo "releasing $1"
  # Copy the xpi
  chmod 766 $(XPI_NAME)-$1.xpi
	scp -p $(XPI_NAME)-$1.xpi $(SSH_USER)@stage.mozilla.org:$(FTP_ROOT_PATH)/$1/$(XPI_NAME)-$1.xpi
  # Update the "latest" symbolic link
	ssh $(SSH_USER)@stage.mozilla.org 'cd $(FTP_ROOT_PATH)/$1/ && ln -fs $(XPI_NAME)-$1.xpi $(ADDON_NAME)-$1-latest.xpi'
  # Update the update manifest
	sed -e 's#@@UPDATE_LINK@@#$(UPDATE_LINK)$1/$(XPI_NAME)-$1.xpi#;s#@@ADDON_VERSION@@#$(ADDON_VERSION)#' template/update.rdf > update.rdf
  chmod 766 update.rdf
	scp -p update.rdf $(SSH_USER)@stage.mozilla.org:$(FTP_ROOT_PATH)/$1/update.rdf
endef

release: $(XPIS)
	@if [ -z $(SSH_USER) ]; then \
	  echo "release target requires SSH_USER env variable to be defined."; \
	  exit 1; \
	fi
	ssh $(SSH_USER)@stage.mozilla.org 'mkdir -m 755 -p $(FTP_ROOT_PATH)/{win32,linux32,linux64,mac64}'
	@$(call release,win32)
	@$(call release,linux32)
	@$(call release,linux64)
	@$(call release,mac64)

