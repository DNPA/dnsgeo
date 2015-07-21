#!/bin/bash
cat Dockerfile | envsubst | docker build -t dnpa/dnsgeo -
