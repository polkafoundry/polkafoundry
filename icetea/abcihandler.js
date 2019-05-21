const { getBlock, getTx, replyQuery } = require('./helper/abci')
const app = require('./app')
const utils = require('./helper/utils')

// turn on debug logging
// require('debug').enable('abci*')

// turn on logging state diff to console
if (utils.isDevMode() && utils.envEnabled('PRINT_STATE_DIFF')) {
  app.addStateObserver(require('./helper/diff'))
}

module.exports = () => {
  return app.loadState().then(() => handler)
}

const handler = {

  initChain ({ consensusParams, validators }) {
    app.installSystemContracts()
    return { consensusParams, validators }
  },

  async info () {
    return Object.assign({
      data: 'icetea',
      version: '0.0.1',
      appVerion: '0.0.1'
    }, await app.activate())
  },

  checkTx (req) {
    try {
      app.checkTx(getTx(req))
      return {}
    } catch (err) {
      return { code: 1, log: String(err) }
    }
  },

  beginBlock (req) {
    app.setBlock(getBlock(req))
    return {}
  },

  deliverTx (req) {
    try {
      const tx = getTx(req)

      const tags = []
      const data = app.execTx(tx, tags)

      const result = {}
      if (typeof data !== 'undefined') {
        result.data = Buffer.from(utils.serialize(data))
      }

      result.tags = []
      if (typeof tags !== 'undefined' && Object.keys(tags).length) {
        Object.keys(tags).forEach((key) => {
          result.tags.push({ key: Buffer.from(key), value: Buffer.from(tags[key]) })
        })
      }

      // add system tags
      result.tags.push({ key: Buffer.from('tx.from'), value: Buffer.from(tx.from) })
      result.tags.push({ key: Buffer.from('tx.to'), value: Buffer.from(tx.isContractCreation() ? data : tx.to) })
      result.tags.push({ key: Buffer.from('tx.payer'), value: Buffer.from(tx.payer) })

      // console.log(result);
      return result
    } catch (err) {
      console.error(err)
      return { code: 1, log: String(err) }
    }
  },

  async commit () {
    const data = await app.persistState()
    return { data } // return the block stateRoot
  },

  query (req) {
    try {
      // console.log(req.path, req.data.toString(), req.prove || false);

      // TODO: handle replying merkle proof to client if requested

      // const prove = !!req.prove;

      const path = req.path
      const data = req.data.toString()

      switch (path) {
        case 'balance':
          return replyQuery({
            balance: app.balanceOf(data)
          })
        case 'state':
          return replyQuery(app.debugState())
        case 'contracts':
          return replyQuery(app.getContractAddresses(data === 'true'))
        case 'metadata': {
          return replyQuery(app.getMetadata(data))
        }
        case 'account_info': {
          return replyQuery(app.getAccountInfo(data))
        }
        case 'invokeView':
        case 'invokePure': {
          const options = JSON.parse(data)
          const result = app[path](options.address, options.name, options.params, options.options)
          return replyQuery(result)
        }
      }

      return { code: 1, info: 'Path not supported' }
    } catch (error) {
      return { code: 2, info: String(error) }
    }
  }
}
