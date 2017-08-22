const moment = require('moment')
const bluebird = require('bluebird')
const cozyClient = require('./cozyclient')
const DOCTYPE = 'io.cozy.bank.operations'
const log = require('./logger').namespace('linkBankOperations')

const fetchNeighboringOperations = (bill, options) => {
  let date = new Date(bill.paidDate || bill.date)
  let startDate = moment(date).subtract(options.minDateDelta, 'days')
  let endDate = moment(date).add(options.maxDateDelta, 'days')

  // Get the operations corresponding to the date interval around the date of the bill
  let startkey = `${startDate.format('YYYY-MM-DDT00:00:00.000')}Z`
  let endkey = `${endDate.format('YYYY-MM-DDT00:00:00.000')}Z`
  return cozyClient.data.defineIndex(DOCTYPE, ['date']).then(index =>
    cozyClient.data.query(index, {
      selector: {
        date: {
          $gt: startkey,
          $lt: endkey
        }
      }
    })
  )
}

const findMatchingOperation = (bill, operations, options) => {
  let amount = Math.abs(bill.amount)

  // By default, a bill is an expense. If it is not, it should be
  // declared as a refund: isRefund=true.
  if (bill.isRefund === true) amount *= -1

  for (let operation of operations) {
    let opAmount = Math.abs(operation.amount)

    // By default, an bill is an expense. If it is not, it should be
    // declared as a refund: isRefund=true.
    if (bill.isRefund === true) opAmount *= -1

    let amountDelta = Math.abs(opAmount - amount)

    // Select the operation to link based on the minimal amount
    // difference to the expected one and if the label matches one
    // of the possible labels (identifier)
    for (let identifier of options.identifiers) {
      const hasIdentifier =
        operation.label.toLowerCase().indexOf(identifier) >= 0
      const similarAmount = amountDelta <= options.amountDelta
      if (hasIdentifier && similarAmount) {
        return operation
      }
    }
  }
  return null
}

const reimbursedTypes = ['health_costs']

const equalDates = function (d1, d2) {
  return d1 && d2 && d1.year == d2.year && d1.month == d2.month && d1.date == d2.date
}

const findReimbursedOperation = (bill, operations, options) => {
  let originalAmount = Math.abs(bill.originalAmount)

  const canBeReimbursed = reimbursedTypes.indexOf(bill.type) > -1
  if (!canBeReimbursed) {
    return null
  }

  // By default, an bill is an expense. If it is not, it should be
  // declared as a refund: isRefund=true.
  if (bill.isRefund === true) originalAmount *= -1

  for (let operation of operations) {
    let opAmount = operation.amount
    // By default, an bill is an expense. If it is not, it should be
    // declared as a refund: isRefund=true.
    if (bill.isRefund === true) opAmount *= -1

    const amountExpensedInferiorToReimbursement = bill.amount < opAmount
    const sameAmount = originalAmount == operation.amount
    const sameDate = equalDates(bill.originalDate, operation.date)
    if (sameAmount && sameDate && amountExpensedInferiorToReimbursement) {
      return operation
    }
  }
  return null
}

const addBillToOperation = function(bill, operation) {
  if (operation.bills && operation.bills.indexOf(bill._id) > -1) {
    return Promise.resolve()
  }

  const billIds = operation.billIds || []
  billIds.push(`io.cozy.bills:${bill._id}`)

  return cozyClient.data.updateAttributes(DOCTYPE, operation._id, {
    bills: billIds
  })
}

const addReimbursementToOperation = function (bill, operation, matchingOperation) {
  if (operation.reimbursements && operation.reimbursements.indexOf(bill._id) > -1) {
    return Promise.resolve()
  }

  const reimbursements = operation.reimbursements || []
  reimbursements.push({
    billId: `io.cozy.bills:${bill._id}`,
    amount: bill.amount,
    operationId: matchingOperation && matchingOperation._id
  })

  return cozyClient.data.updateAttributes(DOCTYPE, operation._id, {
    reimbursements: reimbursements
  })
}

const linkMatchingOperation = function (bill, operations, options) {
  const matchingOp = findMatchingOperation(bill, operations, options)
  if (matchingOp){
    if (!matchingOp) { return }
    return addBillToOperation(bill, matchingOp)
  }
}

const linkReimbursedOperation = function (bill, operations, options, matchingOp) {
  const reimbursedOp = findReimbursedOperation(bill, operations, options)
  if (!reimbursedOp) { return }
  return addReimbursementToOperation(bill, reimbursedOp, matchingOp)
}

/**
 * Link bills to
 *   - their matching banking operation (debit)
 *   - to their reimbursement (credit)
 */
const linkBillsToOperations = function(bills, options) {
  return bluebird.each(bills, bill => {
    // Get all operations whose date is close to out bill
    let operations
    return fetchNeighboringOperations(bill, options)
      .then(ops => {
        operations = ops
        return linkMatchingOperation(bill, operations, options)
      }).then(matchingOperation => {
        return linkReimbursedOperation(bill, operations, options, matchingOperation)
      })
  })
}

module.exports = (bills, doctype, fields, options = {}) => {
  // Use the custom bank identifier from user if any
  if (fields.bank_identifier && fields.bank_identifier.length) {
    options.identifiers = [fields.bank_identifier]
  }

  if (typeof options.identifiers === 'string') {
    options.identifiers = [options.identifiers.toLowerCase()]
  } else if (Array.isArray(options.identifiers)) {
    options.identifiers = options.identifiers.map(id => id.toLowerCase())
  } else {
    throw new Error(
      'linkBankOperations cannot be called without "identifiers" option'
    )
  }
  log('info', `Bank identifiers: ${options.identifiers}`)

  options.amountDelta = options.amountDelta || 0.001
  options.dateDelta = options.dateDelta || 15
  options.minDateDelta = options.minDateDelta || options.dateDelta
  options.maxDateDelta = options.maxDateDelta || options.dateDelta

  return linkBillsToOperations(bills, options)
}

Object.assign(module.exports, {
  fetchNeighboringOperations,
  findMatchingOperation,
  addBillToOperation,
  linkBillsToOperations,
  findReimbursedOperation
})
