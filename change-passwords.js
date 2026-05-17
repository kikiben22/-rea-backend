require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const db = mongoose.connection.db;
  const list = [
    { email: 'admin@rea.dz',   pwd: 'admin1234'  },
    { email: 'benali@rea.dz',  pwd: 'doctor1234' },
    { email: 'ouahab@rea.dz',  pwd: 'doctor1234' },
    { email: 'hadj@rea.dz',    pwd: 'nurse1234'  },
    { email: 'meziani@rea.dz', pwd: 'nurse1234'  },
  ];
  for (const { email, pwd } of list) {
    const hash = await bcrypt.hash(pwd, 12);
    await db.collection('users').updateOne({ email }, { $set: { password: hash } });
    console.log('✅', email, '→', pwd);
  }
  await mongoose.disconnect();
  console.log('\nMots de passe mis à jour!');
}).catch(e => console.error('ERREUR:', e.message));
