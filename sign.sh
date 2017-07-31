#!/bin/bash

# Help signing the add-on as "Mozilla Extension" to make it work with Firefox 57+
# More info on:
# https://mana.mozilla.org/wiki/display/SVCOPS/Sign+a+Mozilla+Internal+Extension

set -e

export MOZENV="prod"

if [ $MOZENV == "prod" ]; then
  export AWS_DEFAULT_REGION=us-west-2
else
  export AWS_DEFAULT_REGION=us-east-1
fi

if [ -z $SIGN_AWS_ACCESS_KEY_ID ]; then
  echo "You should set SIGN_AWS_ACCESS_KEY_ID variable"
  exit
fi

if [ -z $SIGN_AWS_SECRET_ACCESS_KEY ]; then
  echo "You should set SIGN_AWS_SECRET_ACCESS_KEY variable"
  exit
fi

if [ -z $1 ] || [ ! -f $1 ]; then
  echo "$0 expects path to xpi file as first argument"
  exit
fi
XPI=$1

if ! [ -x "$(command -v aws)" ]; then
  echo "You should setup 'aws' in your environment"
  exit
fi
if ! [ -x "$(command -v sign-xpi)" ]; then
  echo "You should setup 'sign-xpi' in your environment"
  echo "See: https://mana.mozilla.org/wiki/display/SVCOPS/Sign+a+Mozilla+Internal+Extension"
  exit
fi

echo "Signing $XPI"
OLD_AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID
OLD_AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY
export AWS_ACCESS_KEY_ID=$SIGN_AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=$SIGN_AWS_SECRET_ACCESS_KEY
sign-xpi -t mozillaextension -e $MOZENV -s net-mozaws-$MOZENV-addons-signxpi-input $XPI
aws s3 cp s3://net-mozaws-$MOZENV-addons-signxpi-output/$XPI .
export AWS_ACCESS_KEY_ID=$OLD_AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=$OLD_AWS_SECRET_ACCESS_KEY
