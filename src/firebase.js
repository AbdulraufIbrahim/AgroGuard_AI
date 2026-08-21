import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCUqBs9NqWzMCWe7PbGgZLhmp85gBhwcoM",
  authDomain: "plant-disease-dectection-001.firebaseapp.com",
  databaseURL:
    "https://plant-disease-dectection-001-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "plant-disease-dectection-001",
  storageBucket: "plant-disease-dectection-001.appspot.com",
  messagingSenderId: "464613687858",
  appId: "1:464613687858:web:58f9c53faf28c94b66f22b",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
