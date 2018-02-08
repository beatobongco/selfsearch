'use strict'

// OPTIONS

var CHR_BUFFER = 50

String.prototype.splice = function(idx, rem, str) {
  return this.slice(0, idx) + str + this.slice(idx + Math.abs(rem))
}

var app = new Vue({
  el: '#app',
  data: {
    isLoading: true,
    firstRun: true,
    message: 'Loading...',
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
            app.message = 'Existing data found in localstorage.'
            app.idx = lunr.Index.load(JSON.parse(value))
            localforage
              .getItem('store')
              .then(function (value) {
                app.store = JSON.parse(value)
                localforage
                  .getItem('lastPull')
                  .then(function (value) {
                    app.lastPull = value
                    app.isLoading = false
                    app.searchFromHash()
                  })
              })
          } else {
            app.message = 'Creating stores...'
            app.createNotesStore()
              .then(app.createBookStore)
              .then(app.buildLunr)
          }
        })
    },
    searchFromHash: function() {
      //search
      var query = window.location.hash.replace('#', '')

      if (query) {
        app.setQuery(query)
        app.search()
      }
    },
    refresh: function() {
      app.isLoading = true
      var r = ['store', 'lunr', 'lastPulled']
      var q = []

      for (var i = 0; i < r.length; i++) {
        q.push(localforage.removeItem(r[i]))
      }

      Promise.all(q).then(app.init)
    },
    buildLunr: function () {
      console.log('Building lunr database...')
      app.message = 'Building lunr database...'
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
          app.message = 'Database saved locally.'
        })

      localforage
        .setItem('lunr', JSON.stringify(app.idx))
        .then(function() {
          var d = new Date()
          d = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours() + ':' + d.getMinutes()

          localforage
            .setItem('lastPull', d)
            .then(function(value) {
              app.lastPull = d
              app.message = 'Database built and saved locally at ' + value
              app.isLoading = false
              app.searchFromHash()
            })
        })

    },
    createNotesStore: function() {
      console.log('Loading notes...')
      app.message = 'Loading notes... (this could take a minute)'
      return new Promise(function(resolve) {
        var deferreds = []
        // we need to scrape raw from github because orig URL has CORS
        // this is trickier to generalize
        var rawURL = 'https://raw.githubusercontent.com/beatobongco/TIL/master/day_notes/'
        var origURL = 'https://github.com/beatobongco/TIL/blob/master/day_notes/'

        superagent
          .get('https://beatobongco.com/TIL/day_notes/')
          .then(function(res) {
            var tempHTML = document.createElement('html')
            tempHTML.innerHTML = res
            $('ul li a', tempHTML).each(function(i, obj) {
              var toScrape = $(obj).attr('href').replace(origURL, rawURL)
              deferreds.push(
                superagent
                  .get(toScrape)
                  .then(function(res2) {
                    var rawNotes = document.createElement('html')
                    rawNotes.innerHTML = res2
                    var linkedURL = toScrape.replace(rawURL, origURL)
                    app.store[linkedURL] = {
                      'id': linkedURL,
                      'title': toScrape.replace(rawURL, ''),
                      'body': res2
                    }
                  })
              )
            }) //each
            Promise.all(deferreds).then(resolve)
          })
      })
    },
    createBookStore: function() {
      // side effect: adds to app.store's keys and values
      // returns an array of $.get Promises
      console.log('Loading books...')
      app.message = 'Loading book highlights... (this could take a minute)'
      return new Promise(function(resolve, reject) {
        var deferreds = []

        superagent
          .get('https://beatobongco.com/book-highlights/')
          .then(function(res) {
            var tempHTML = document.createElement('html')
            tempHTML.innerHTML = res

            $('.entry a', tempHTML).each(function(i, obj) {
              var href = $(obj).attr('href')
              // could make this into scrapeIf function rule
              if (href.startsWith('book')) {
                var fullURL = 'https://beatobongco.com/book-highlights/' + href
                deferreds.push(
                  superagent
                    .get(fullURL)
                    .then(function(res2) {
                      var rawNotes = document.createElement('html')
                      rawNotes.innerHTML = res2
                      // #raw-notes can be generalized as a selector text
                      var notesText = $('#raw-notes', rawNotes).text()
                      var bookTitle = notesText.split('\n')[2]
                      if (!notesText.startsWith('Bought physical copy.')) {
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
            Promise.all(deferreds).then(resolve)
          })
      })
    },
    setQuery: function(q) {
      this.query = q
    },
    search: function() {
      this.firstRun = false
      this.results.splice(0, this.results.length)
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
        var highlightQuery = null

        for (var j = 0; j < indexes.length; j++) {

          var _index = indexes[j].index
          var _word = indexes[j].word
          var text = this.store[k]

          // first highlight will be search query
          if (j === 0) {
            highlightQuery = _word
          }

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
          url: k + '?highlight=' + highlightQuery,
          title: text.title,
          highlights: highlights
        })
      }

      // set url args
      document.location.hash = this.query
      var sel = document.querySelector('.query')
      if (sel) sel.focus()
    }
  }
})
