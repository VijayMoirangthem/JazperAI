@echo off
title Jasper phone link
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\jasper-remote.ps1" %*
