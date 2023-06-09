const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')('sk_test_51NGxRvFLPuXl3J7VhkYZScCJIw8OfBEMcWh43aFgNE2Rsg9xbQBy7eeF1boJbhl4w4iXzmwG5IsM4ITL8EiY3V6s00sTiOLi3D')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const app = express();
const port = process.env.PORT || 5000


// middleware
app.use(cors())
app.use(express.json())

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'unauthorized access' });
  }
  // bearer token
  const token = authorization.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    req.decoded = decoded;
    next();
  })
}



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8o8vfkj.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const menuCollections = client.db('bistroDb').collection('menu');
    const reviewCollections = client.db('bistroDb').collection('reviews');
    const cartCollections = client.db('bistroDb').collection('carts');
    const usersCollections = client.db('bistroDb').collection('users');
    const paymentCollections = client.db('bistroDb').collection('payments');

    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })

      res.send({ token })
    })

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await usersCollections.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(404).send({ error: true, message: 'forbidden messsage' })
      }
      next()
    }

    // users related appis
    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollections.find().toArray();
      res.send(result)
    });
    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollections.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user alreday exists' })
      }
      const result = await usersCollections.insertOne(user);
      res.send(result);
    });

    // security layer : verifyJWt
    // email same
    // check admin
    app.get('/users/admin/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        return res.send({ admin: false })
      }

      const query = { email: email };
      const user = await usersCollections.findOne(query);
      const result = { admin: user?.role === 'admin' }
      res.send(result)
    })


    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          role: 'admin'
        },
      };
      const result = await usersCollections.updateOne(filter, updateDoc);
      res.send(result)
    })

    // menu relataed Apis
    app.get('/menu', async (req, res) => {
      const result = await menuCollections.find().toArray();
      res.send(result)
    });

    app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      const result = await menuCollections.insertOne(newItem);
      res.send(result)
    });

    app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollections.deleteOne(query);
      res.send(result)
    })

    // review related apis
    app.get('/reviews', async (req, res) => {
      const result = await reviewCollections.find().toArray();
      res.send(result)
    });

    // cart collection apis
    app.get('/carts', verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([])
      }

      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(403).send({ error: true, message: 'Forbidden access' })
      }

      const query = { email: email };
      const result = await cartCollections.find(query).toArray();
      res.send(result)

    })
    app.post('/carts', async (req, res) => {
      const item = req.body;
      const result = await cartCollections.insertOne(item);
      res.send(result)
    });

    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      console.log(id)
      const query = { _id: new ObjectId(id) }
      const result = await cartCollections.deleteOne(query);
      res.send(result)
    });


    // create payment intent
    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      });

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    });
    // payments Related api
    app.post('/payments', verifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollections.insertOne(payment);
      const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } }
      const deleteResult = await cartCollections.deleteMany(query)
      res.send({ insertResult, deleteResult });
    });
    app.get('/admin-stats',verifyJWT, verifyAdmin, async (req, res) => {
      const users = await usersCollections.estimatedDocumentCount();
      const products = await menuCollections.estimatedDocumentCount();
      const orders = await paymentCollections.estimatedDocumentCount();

      const payments = await paymentCollections.find().toArray();
      const revenue = payments.reduce((sum, item) => sum + item.price ,0)
      res.send({
        users,
        products,
        orders,
        revenue
      })
    })


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run();

app.get('/', (req, res) => {
  res.send('Restaurent is Open')
});

app.listen(port, () => {
  console.log(`server is Running on Port ${port}`)
})