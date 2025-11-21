import express from "express";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET;

app.use(express.static("public"));
app.use(express.json());
app.use(cookieParser());

// AUTH MIDDLEWARE
function auth(req,res,next){
  try{
    req.user = jwt.verify(req.cookies.token, JWT_SECRET);
    next();
  }catch{
    return res.status(401).json({success:false});
  }
}

// SIGNUP
app.post("/api/signup", async(req,res)=>{
  const {name,email,password} = req.body;
  const hash = await bcrypt.hash(password,10);
  await pool.query(
    `INSERT INTO users(name,email,password,role) VALUES($1,$2,$3,'user')`,
    [name,email,hash]
  );
  res.json({success:true});
});

// LOGIN
app.post("/api/login", async(req,res)=>{
  const {email,password} = req.body;
  const result = await pool.query(`SELECT * FROM users WHERE email=$1`,[email]);
  const user = result.rows[0];

  if(!user) return res.json({success:false,message:"User not found"});

  const match = await bcrypt.compare(password,user.password);
  if(!match) return res.json({success:false,message:"Invalid credentials"});

  const token = jwt.sign({id:user.id,role:user.role},JWT_SECRET);
  res.cookie("token",token,{httpOnly:true});

  res.json({success:true,user});
});

// CREATE POEM
app.post("/api/poems/create", auth, async(req,res)=>{
  const {title,content} = req.body;
  await pool.query(
    `INSERT INTO poems(user_id,title,content) VALUES($1,$2,$3)`,
    [req.user.id,title,content]
  );
  res.json({success:true});
});

// GET POEMS
app.get("/api/poems", async(req,res)=>{
  const search = req.query.search;
  let q = `
   SELECT poems.*, users.name as author 
   FROM poems JOIN users ON poems.user_id = users.id
  `;

  if(search) q += ` WHERE poems.content ILIKE '%${search}%'`;
  q += " ORDER BY poems.id DESC";

  const result = await pool.query(q);
  res.json({poems:result.rows});
});

// DELETE POEM
app.delete("/api/poems/:id", auth, async(req,res)=>{
  const id = req.params.id;
  const result = await pool.query(`SELECT user_id FROM poems WHERE id=$1`,[id]);
  const row = result.rows[0];

  if(!row) return res.status(404).json({});

  if(row.user_id !== req.user.id && req.user.role !== "admin"){
    return res.status(403).json({});
  }

  await pool.query(`DELETE FROM poems WHERE id=$1`,[id]);
  res.json({success:true});
});

export default app;
