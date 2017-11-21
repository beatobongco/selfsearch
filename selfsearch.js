'use strict'

// OPTIONS

var CHR_BUFFER = 50

// https://lunrjs.com/guides/index_prebuilding.html
// TODO:
// * add loading + progress (get counts)
// * add vue transitions

String.prototype.splice = function(idx, rem, str) {
  return this.slice(0, idx) + str + this.slice(idx + Math.abs(rem))
}

var app = new Vue({
  el: '#app',
  data: {
    store: {},
    idx: null,
    lastPull: null,
    query: '',
    results: []
  },
  mounted: function() {
    this.init()
  },
  methods: {
    init: function() {
      this.query = ''
      this.results = []
      localforage
        .getItem('lunr')
        .then(function(value) {
          if (value) {
            console.log('Existing lunr found')
            app.idx = lunr.Index.load(JSON.parse(value))
            localforage
              .getItem('store')
              .then(function (value) {
                app.store = JSON.parse(value)
              })
            localforage
              .getItem('lastPull')
              .then(function (value) {
                app.lastPull = value
              })
          } else {
            console.log('Creating stores...')
            var q = []
            app.createNotesStore().then(function(value) {
              Promise.all(value).then(
                app.createBookStore().then(function(value3) {
                  Promise.all(value3).then(app.buildLunr)
                })
              )
            })

          }
        })
    },
    refresh: function() {
      var r = ['store', 'lunr', 'lastPulled']
      var q = []

      for (var i = 0; i < r.length; i++) {
        q.push(localforage.removeItem(r[i]))
      }

      Promise.all(q).then(function() {
        app.init()
      })
    },
    buildLunr: function () {
      console.log('Building lunr...')
      // builds lunr based on contents of store
      this.idx = lunr(function() {
        this.field('title')
        this.field('body')
        for (var prop in app.store) {
          this.add(app.store[prop])
        }
      })

      localforage
        .setItem('store', JSON.stringify(app.store))
        .then(function() {
          console.log('Store saved locally')
        })

      localforage
        .setItem('lunr', JSON.stringify(app.idx))
        .then(function() {
          var d = new Date()
          d = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() + ' ' + d.getHours() + ':' + d.getMinutes()

          localforage
            .setItem('lastPull', d)
            .then(function(value) {
              app.lastPull = d
              console.log('Lunr built and saved locally at ' + value)
            })
        })

    },
    createNotesStore: function() {
      return new Promise(function(resolve, reject) {
        var deferreds = []
        var rawURL = 'https://raw.githubusercontent.com/beatobongco/TIL/master/day_notes/'
        var origURL = 'https://github.com/beatobongco/TIL/blob/master/day_notes/'

        $.get('https://beatobongco.com/TIL/day_notes/', function(resp) {
          var tempHTML = document.createElement('html')
          tempHTML.innerHTML = resp
          $('ul li a', tempHTML).each(function(i, obj) {
            var toScrape = $(obj).attr('href').replace(origURL, rawURL)
            deferreds.push(
              $.get(toScrape, function(resp2) {
                var rawNotes = document.createElement('html')
                rawNotes.innerHTML = resp2
                var linkedURL = toScrape.replace(rawURL, origURL)
                console.log('Loading day notes...')
                app.store[linkedURL] = {
                  'id': linkedURL,
                  'title': toScrape.replace(rawURL, ''),
                  'body': resp2
                }
              })
            )
          }) // each
          resolve(deferreds)
        })
      })
    },
    createBookStore: function() {
      // side effect: adds to app.store's keys and values
      // returns an array of $.get Promises
      return new Promise(function(resolve, reject) {
        var deferreds = []

        $.get('https://beatobongco.com/book-highlights/', function(resp) {
          var tempHTML = document.createElement('html')
          tempHTML.innerHTML = resp

          $('.entry a', tempHTML).each(function(i, obj) {
            var href = $(obj).attr('href')
            if (href.startsWith('book')) {
              var fullURL = 'https://beatobongco.com/book-highlights/' + href
              deferreds.push(
                $.get(fullURL, function(resp2) {
                  var rawNotes = document.createElement('html')
                  rawNotes.innerHTML = resp2
                  var notesText = $('#raw-notes', rawNotes).text()
                  var bookTitle = notesText.split('\n')[2]
                  if (!notesText.startsWith('Bought physical copy.')) {
                    console.log('Loading book highlights...')
                    app.store[fullURL] = {
                      'id': fullURL,
                      'title': bookTitle,
                      'body': notesText
                    }
                  }
                })
              )
            }
          }) //each
          resolve(deferreds)
        })
      })
    },
    search: function() {
      this.results = []
      var res = this.idx.search(this.query)

      for (var i = 0; i < res.length; i++) {
        var k = res[i].ref

        var matchdata = res[i]['matchData']['metadata']
        var indexes = []

        for (var m in matchdata) {
          indexes.push({
            word: m,
            index: this.store[k].body.toLowerCase().indexOf(m)
          })
        }

        var highlights = []

        for (var j = 0; j < indexes.length; j++) {
          var _index = indexes[j].index
          var _word = indexes[j].word
          var text = this.store[k]

          var start = _index - CHR_BUFFER
          start = start > -1 ? start : 0

          var end = _index + CHR_BUFFER + 1
          end = end < text.body.length ? end : text.body.length

          var _highlight = text.body.slice(start, end)
          var tba = '<span class="highlight">'
          var hlIndex = _highlight.toLowerCase().indexOf(_word)
          _highlight = _highlight.splice(hlIndex, 0, tba)
          _highlight = _highlight.splice(hlIndex + _word.length + tba.length, 0, '</span>')
          highlights.push('...' + _highlight + '... ')
        }

        this.results.push({
          url: k,
          title: text.title,
          highlights: highlights
        })
      }
    }
  }
})
