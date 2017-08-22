jest.mock('./cozyclient')

import linkBankOperations, {
  findMatchingOperation,
  findReimbursedOperation,
  addBillToOperation,
  fetchNeighboringOperations
} from './linkBankOperations'

const cozyClient = require('./cozyclient')

const matchOpts = {
  identifiers: ['Harmonie Mutuelle'.toLowerCase()],
  amountDelta: 0.1
}

const searchOpts = {
  minDateDelta: 10,
  maxDateDelta: 15
}

beforeEach(function() {
  cozyClient.data.updateAttributes.mockReset()
})

test('fetchNeighboringOperations', function() {
  const bill = {
    date: new Date(2017, 10, 12)
  }
  const INDEX = 'index'
  cozyClient.data.defineIndex.mockReturnValue(Promise.resolve(INDEX))
  return fetchNeighboringOperations(bill, searchOpts).then(function() {
    expect(cozyClient.data.query).lastCalledWith(INDEX, {
      selector: {
        date: {
          $gt: '2017-11-02T00:00:00.000Z',
          $lt: '2017-11-27T00:00:00.000Z'
        }
      }
    })
  })
})

test('findMatchingOperation returns null if no operations', function() {
  const bill = {
    amount: 123
  }
  const ops = []
  expect(findMatchingOperation(bill, ops, matchOpts)).toBe(null)
})

test('findMatchingOperation returns a matching operation', function() {
  const bill = {
    amount: -100
  }
  const bill2 = { ...bill, isRefund: false }
  const bill3 = { ...bill, amount: -200 }

  const ops = [
    { amount: -20, label: 'Billet de train' },
    { amount: -100, label: 'Harmonie Mutuelle Remboursement' },
    { amount: -80, label: "Matériel d'escalade" },
    { amount: -5.5, label: 'Mexicain' },
    { amount: -2.6, label: 'Chips' }
  ]
  expect(findMatchingOperation(bill, ops, matchOpts)).toBe(ops[1])
  expect(findMatchingOperation(bill2, ops, matchOpts)).toBe(ops[1])
  expect(findMatchingOperation(bill3, ops, matchOpts)).toBe(null)
})

test('addBillToOperation', function() {
  const bill = {
    amount: -110,
    fileobject: {
      _id: 123456
    },
    _id: 'b1'
  }
  const operation = {
    _id: 123456
  }

  addBillToOperation(bill, operation)
  expect(
    cozyClient.data.updateAttributes
  ).lastCalledWith('io.cozy.bank.operations', 123456, {
    bills: ['io.cozy.bills:b1']
  })
})

test('linkBankOperations match operations to bills', function() {
  // We mock defineIndex/query so that fetchOperations returns the right operations
  const INDEX = 'index'

  const bills = [
    {
      amount: -30,
      date: new Date(2017, 10, 12),
      fileobject: {
        _id: 'f1'
      },
      _id: 'b1'
    },
    {
      amount: -120,
      date: new Date(2017, 10, 10),
      fileobject: {
        _id: 'f2'
      },
      _id: 'b2'
    }
  ]

  const operations = [
    { amount: -20, label: 'Billet de train', _id: 'o1' },
    { amount: -120, label: 'Facture SFR', _id: 'o2' },
    { amount: -30, label: 'Facture SFR', _id: 'o3' },
    { amount: -80, label: "Matériel d'escalade", _id: 'o4' },
    { amount: -5.5, label: 'Burrito', _id: 'o5' },
    { amount: -2.6, label: 'Salade', _id: 'o6' }
  ]

  cozyClient.data.defineIndex.mockReturnValue(Promise.resolve(INDEX))
  cozyClient.data.query.mockReturnValue(Promise.resolve(operations))

  return linkBankOperations(
    bills,
    null,
    {},
    { ...searchOpts, ...matchOpts, identifiers: ['SFR'] }
  ).then(function() {
    expect(cozyClient.data.updateAttributes.mock.calls).toEqual([
      ['io.cozy.bank.operations', 'o3', { bills: ['io.cozy.bills:b1'] }],
      ['io.cozy.bank.operations', 'o2', { bills: ['io.cozy.bills:b2'] }]
    ])
  })
})

test('findReimbursedOperation', function() {
  const bill = {
    isRefund: true,
    amount: 20,
    originalAmount: -100,
    type: 'health_costs',
    originalDate: new Date(2017, 10, 5)
  }
  const bill2 = { ...bill, isRefund: false } // not refund, cannot be a reimbursement
  const bill3 = { ...bill, amount: 200 } // amount reimbursed superior to expense
  const bill4 = { ...bill, type: 'phone' } // is not a reimbursable type

  const ops = [
    { amount: -20, label: 'Billet de train' },
    { amount: 100, label: 'Harmonie Mutuelle Remboursement' },
    { amount: -80, label: "Matériel d'escalade" },
    { amount: -5.5, label: 'Mexicain' },
    { amount: -2.6, label: 'Chips' },
    {
      amount: -100,
      label: 'Visite chez le médecin',
      date: new Date(2017, 10, 5)
    }
  ]
  expect(findReimbursedOperation(bill, ops, matchOpts)).toBe(ops[5])
  expect(findReimbursedOperation(bill2, ops, matchOpts)).toBe(null)
  expect(findReimbursedOperation(bill3, ops, matchOpts)).toBe(null)
  expect(findReimbursedOperation(bill4, ops, matchOpts)).toBe(null)
})

test('linkBankOperations match operations to reimbursements bills', function() {
  // We mock defineIndex/query so that fetchOperations returns the right operations
  const INDEX = 'index'

  const bills = [

    // Remboursement du médecin
    {
      amount: 5,
      originalAmount: -30,
      type: 'health_costs',
      originalDate: new Date(2017, 10, 10),
      date: new Date(2017, 10, 15),
      isRefund: true,
      fileobject: {
        _id: 'f1'
      },
      _id: 'b1'
    },

    // Facture SFR
    {
      amount: -120,
      date: new Date(2017, 10, 10),
      fileobject: {
        _id: 'f2'
      },
      _id: 'b2'
    }
  ]

  const operations = [
    { amount: -20, label: 'Visite chez le médecin', _id: 'o1' },
    {
      amount: 5,
      label: 'Remboursement CPAM',
      _id: 'o1',
      date: new Date(2017, 10, 15)
    },
    {
      amount: -120,
      label: 'Facture SFR',
      _id: 'o2',
      date: new Date(2017, 10, 8)
    },
    {
      amount: -30,
      label: 'Facture SFR',
      _id: 'o3',
      date: new Date(2017, 10, 7)
    },
    {
      amount: -80,
      label: "Matériel d'escalade",
      _id: 'o4',
      date: new Date(2017, 10, 7)
    },
    { amount: -5.5, label: 'Burrito', _id: 'o5', date: new Date(2017, 10, 5) },
    { amount: -2.6, label: 'Salade', _id: 'o6', date: new Date(2017, 10, 6) }
  ]

  cozyClient.data.defineIndex.mockReturnValue(Promise.resolve(INDEX))
  cozyClient.data.query.mockReturnValue(Promise.resolve(operations))

  return linkBankOperations(
    bills,
    null,
    {},
    { ...searchOpts, ...matchOpts, identifiers: ['SFR'] }
  ).then(function() {
    expect(cozyClient.data.updateAttributes.mock.calls).toEqual([
      [
        'io.cozy.bank.operations',
        'o3',
        {
          reimbursements: [
            { billId: 'io.cozy.bills:b1', amount: 5, operationId: undefined }
          ]
        }
      ],
      ['io.cozy.bank.operations', 'o2', { bills: ['io.cozy.bills:b2'] }]
    ])
  })
})
