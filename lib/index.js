'use strict';

var Promise = require('bluebird');
var xml2js = Promise.promisifyAll(require('xml2js'));
var fs = Promise.promisifyAll(require('fs'));

function stringifyToXML(object) {
  return new xml2js.Builder().buildObject(object);
}

function readXML(filename) {
  return fs.readFileAsync(filename).then(String).then(xml2js.parseStringAsync);
}

function getTrackPoints(input) {
  if (input.TrainingCenterDatabase.Activities.length > 1) {
    throw new Error('TODO implement multiple activities');
  }
  input = input.TrainingCenterDatabase.Activities[0];

  if (input.Activity.length > 1) {
    throw new Error('TODO implement multiple activity');
  }
  input = input.Activity[0];

  return input.Lap.reduce(function (trackpoints, input) {
    if (input.Track.length > 1) {
      throw new Error('TODO implement multiple tracks');
    }
    input = input.Track[0];

    return trackpoints.concat(input.Trackpoint);
  }, []);
}

function has(metric, trackpoints) {
  return trackpoints.some(function (trackpoint) {
    return trackpoint[metric] && trackpoint[metric].length > 0;
  });
}

function time(p) {
  return Date.parse(p.Time[0]);
}

function interpolate(p, previous, next, get) {
  return get(previous) + ((time(p) - time(previous)) / (time(next) - time(previous))) * (get(next) - get(previous));
}

var features = {
  position: {
    has: function (p) {
      return p.Position && p.Position.length > 0;
    },
    unhide: function (p) {
      if (p.Position) {
        return;
      }
      p.Position = p._Position;
      delete p._Position;
    },
    save: function (trackpoints, p, previous, next) {
      var latitude = interpolate(trackpoints[p], trackpoints[previous], trackpoints[next], function (p) {
        return parseFloat(p.Position[0].LatitudeDegrees[0]);
      });
      var longitude = interpolate(trackpoints[p], trackpoints[previous], trackpoints[next], function (p) {
        return parseFloat(p.Position[0].LongitudeDegrees[0]);
      });

      trackpoints[p]._Position = [
        {
          LatitudeDegrees: [
            String(latitude),
          ],
          LongitudeDegrees: [
            String(longitude),
          ],
        },
      ];
    },
  },

  distance: {
    has: function (p) {
      return p.DistanceMeters && p.DistanceMeters.length > 0;
    },
    unhide: function (p) {
      if (p.DistanceMeters) {
        return;
      }
      p.DistanceMeters = p._DistanceMeters;
      delete p._DistanceMeters;
    },
    save: function (trackpoints, p, previous, next) {
      var distance = interpolate(trackpoints[p], trackpoints[previous], trackpoints[next], function (p) {
        return parseFloat(p.DistanceMeters[0]);
      });

      trackpoints[p]._DistanceMeters = [
        String(distance),
      ];
    },
  },

  heartRate: {
    has: function (p) {
      return p.HeartRateBpm && p.HeartRateBpm.length > 0;
    },
    unhide: function (p) {
      if (p.HeartRateBpm) {
        return;
      }
      p.HeartRateBpm = p._HeartRateBpm;
      delete p._HeartRateBpm;
    },
    save: function (trackpoints, p, previous, next) {
      var heartRate = interpolate(trackpoints[p], trackpoints[previous], trackpoints[next], function (p) {
        return parseInt(p.HeartRateBpm[0].Value[0], 10);
      });

      trackpoints[p]._HeartRateBpm = [
        {
          Value: [
            String(Math.floor(heartRate)),
          ],
        },
      ];
    },
  },
};

function ensureFeature(trackpoints, i, feature) {
  var p = trackpoints[i];

  if (feature.has(p)) {
    return;
  }

  var previous;
  var next;
  var j;

  j = 1;
  while (true) {
    if (i - j < 0) {
      break;
    }

    previous = i - j;
    if (feature.has(trackpoints[previous])) {
      break;
    }
    previous = undefined;

    j++;
  }

  j = 1;
  while (true) {
    if (i + j >= trackpoints.length) {
      break;
    }

    next = i + j;
    if (feature.has(trackpoints[next])) {
      break;
    }
    next = undefined;

    j++;
  }

  if (previous && next) {
    feature.save(trackpoints, i, previous, next);
  }
}

module.exports = function (parameters) {
  return Promise.resolve()
    .then(function () {
      return Promise.props({
        a: readXML(parameters.a),
        b: readXML(parameters.b),
      });
    })
    .then(function (input) {
      var trackpoints = getTrackPoints(input.a).concat(getTrackPoints(input.b));

      trackpoints.sort(function (a, b) {
        return Date.parse(a.Time[0]) - Date.parse(b.Time[0]);
      });

      if (parameters.mode === 'union') {
      } else if (parameters.mode === 'only-during-gps') {
        var first;
        var last;
        for(var i = 0; i < trackpoints.length; i++) {
          if (trackpoints[i].Position) {
            if (first === undefined) {
              first = i;
            } else {
              last = i;
            }
          }
        }
        trackpoints = trackpoints.slice(first, last + 1);
      } else {
        throw new Error('mode must be one of: only-during-gps, all');
      }

      var hasFeature = {
        distance: has('DistanceMeters', trackpoints),
        heartRate: has('HeartRateBpm', trackpoints),
        position: has('Position', trackpoints),
      };

      trackpoints.forEach(function (trackpoint, i, trackpoints) {
        if (hasFeature.distance) {
          ensureFeature(trackpoints, i, features.distance);
        }
        if (hasFeature.heartRate) {
          ensureFeature(trackpoints, i, features.heartRate);
        }
        if (hasFeature.position) {
          ensureFeature(trackpoints, i, features.position);
        }
      });

      trackpoints.forEach(function (trackpoint, i, trackpoints) {
        if (hasFeature.distance) {
          features.distance.unhide(trackpoints[i]);
        }
        if (hasFeature.heartRate) {
          features.heartRate.unhide(trackpoints[i]);
        }
        if (hasFeature.position) {
          features.position.unhide(trackpoints[i]);
        }
      });

      var json = {
        TrainingCenterDatabase: {
          $: {
            xmlns: 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2',
          },
          Activities: [
            {
              Activity: [
                {
                  $: {
                    Sport: 'Running',
                  },
                  Id: [
                    Date.now().toString() + Math.random().toString(),
                  ],
                  Lap: [
                    {
                      Track: [
                        {
                          Trackpoint: trackpoints,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      };

      return fs.writeFileAsync(parameters.output, stringifyToXML(json));
    })
    .then(function () {
      console.log('tcxjoin finished writing ' + parameters.output);
    });
};
