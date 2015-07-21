#!/usr/bin/python
import json

inputfile=open("geo-events.txt")
outputfile=open("geo-events.html","w")
outputfile.write("<html><head><title>Leus overview</title></head><body><h2>Leus overview</h2><ol>\n")
for jsonline in inputfile:
    obj = json.loads(jsonline)
    line = "<li><b>sensor " + obj["sensorname"] + "</b>, " + " <A HREF=\"http://maps.google.com/maps?t=k&q=loc:" + str(obj["location"]["lat"]) + "+" + str(obj["location"]["lng"]) + "\">" + obj["flushtimestamp"] + "</A> (accuracy =" + str(obj["accuracy"]) + ")</li>\n"
    outputfile.write(line)
outputfile.write("</ol></body></html>\n")
