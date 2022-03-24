SHELL:=/bin/bash

.DEFAULT_GOAL := install
.PHONY: bootstrap

export REGION ?= eu-west-1
export BUCKET_NAME ?=
export PROJECT_NAME ?= BlueprintCdkFrontWeb
export PIPELINE_STACK_NAME ?= $PROJECT_NAME-Pipeline
export CI ?= false

install:
	yarn install --frozen-lockfile
	yarn bootstrap

build:
	@yarn build

test:
	CI=${CI} yarn test

test-ui:
	yarn test-ui

lint:
	yarn lint

configure-ui:
	sh packages/website/scripts/configure-ui.sh

web-sync:
	aws s3 sync --exclude *static/* --cache-control "no-cache" --delete packages/website/build/ s3://${BUCKET_NAME}
	aws s3 sync --cache-control "max-age=31536000" --delete packages/website/build/static s3://${BUCKET_NAME}/static

synth:
	@cd packages/infra && \
	yarn cdk synth -a bin/infra.js
	
deploy-local:
	@make install
	@make synth
	@cd packages/infra && \
	yarn cdk -a cdk.out/assembly-$PROJECT_NAME deploy \*

deploy:
	@make install
	@cd packages/infra && \
	yarn cdk deploy $PIPELINE_STACK_NAME

pre-commit:
	@echo "Running pre-commit" checks
	@make lint
	@make build
	@make test
	@make test-ui
	@make deploy-local
