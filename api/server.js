const express = require("express")
const cors = require("cors")

const app = express()

app.use(cors())
app.use(express.json())

app.get("/", (req,res)=>{
  res.send("OneTable API ishlayapti")
})

app.listen(3000, ()=>{
  console.log("Server 3000 portda ishlayapti")
})
